#!/usr/bin/env python3
"""Stage 4 A2: scripted decisions + annotated official runtime + real processes.

No SDK, API key, network request or model inference. Only the client, input file,
clock speed, scenario driver, checks and source comments are local additions.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "upstream"))
import tasks
from events import EventType
from runtime import AgentRuntime

START = "请分析样本文件，完成后给我统计。"
UPDATE = "最终只列行数和标题数。"
QUERY = "现在进度多少？"


class Evidence:
    def __init__(self):
        self.started_at = datetime.now(timezone.utc).isoformat()
        self.t0 = time.monotonic()
        self.records = []

    def add(self, kind, **data):
        # Freeze mutable messages/state at observation time.
        record = {"seq": len(self.records) + 1,
                  "elapsed_s": round(time.monotonic() - self.t0, 4),
                  "kind": kind, **data}
        self.records.append(json.loads(json.dumps(record, ensure_ascii=False)))


class ScriptedClient:
    """A tiny OpenAI-shaped test double; reads actual runtime request messages."""
    def __init__(self, evidence):
        self.evidence = evidence
        self.chat = SimpleNamespace(completions=self)
        self.calls = 0

    async def create(self, *, messages, **_):
        self.calls += 1
        self.evidence.add("scripted_request", call=self.calls, messages=messages)
        await asyncio.sleep(0.01)  # Simulated response delay, not model latency.
        last = messages[-1]
        last_assistant = max((i for i, m in enumerate(messages)
                              if m["role"] == "assistant"), default=0)
        batch = messages[last_assistant + 1:]
        contents = [m.get("content", "") for m in batch]
        call = None
        if last["role"] == "tool":
            # Echo the real tool response; never invent a progress/result value.
            content = "[脚本回复] " + last["content"]
        elif any(s.startswith("[用户打断]") for s in contents):
            content = ("[脚本回复] 当前没有运行中的任务；已有完成结果保留。"
                       if any("（无）" in s for s in contents)
                       else "[脚本回复] 已发出取消请求；是否终止以子进程退出记录为准。")
        elif any(s.startswith("[系统事件｜异步任务完成]") for s in contents):
            result_text = next(s for s in contents
                               if s.startswith("[系统事件｜异步任务完成]"))
            result = json.loads(result_text.split("结果：", 1)[1])
            tid = re.search(r"task_id=(T\d+)", result_text).group(1)
            if any(m.get("content") == UPDATE for m in messages):
                content = f"[脚本最终结果] {tid}：行数={result['lines']}；标题数={result['heading_count']}。"
            else:
                content = f"[脚本最终结果] {tid}：" + json.dumps(result, ensure_ascii=False)
        elif last.get("content") == START:
            content = ""
            call = ("run_terminal_command", {"command": "python analyze_logs.py"})
        elif last.get("content") == QUERY:
            started = next(m["content"] for m in messages
                           if m["role"] == "tool" and "task_id=" in m["content"])
            tid = re.search(r"task_id=(T\d+)", started).group(1)
            content = ""
            call = ("query_task", {"task_id": tid})
        else:
            raise AssertionError(f"Unexpected scripted input: {last}")
        tool_calls = []
        if call:
            name, args = call
            tool_calls.append(SimpleNamespace(
                id=f"offline_call_{self.calls}",
                function=SimpleNamespace(name=name, arguments=json.dumps(args))))
        self.evidence.add("scripted_response", call=self.calls,
                          content=content, tool_call=call)
        msg = SimpleNamespace(content=content, tool_calls=tool_calls)
        return SimpleNamespace(choices=[SimpleNamespace(message=msg)])


class ObservedRuntime(AgentRuntime):
    """Observe official logs and append times without changing scheduling."""
    def __init__(self, client, evidence):
        self.evidence = evidence
        super().__init__(client, model="offline-scripted-not-an-llm")

    def log(self, source, text):
        self.evidence.add("log", source=source, text=text)
        print(f"[{time.monotonic() - self.evidence.t0:5.2f}s] {source:6} | {text}", flush=True)

    def _append(self, event):
        super()._append(event)
        self.evidence.add("trajectory_append", event=event.to_dict())


async def until(predicate, service, label, timeout=12):
    deadline = time.monotonic() + timeout
    while not predicate():
        if service.done():
            await service  # Surface runtime errors immediately.
            raise RuntimeError("Runtime stopped before " + label)
        if time.monotonic() >= deadline:
            raise TimeoutError(label)
        await asyncio.sleep(0.01)


def outputs(rt):
    return [e.message["content"] for e in rt.trajectory if e.type == EventType.AGENT_OUTPUT]


def verify(rt, evidence, scenario, client):
    """Check external outcomes, request visibility and OS-process receipts."""
    state, = rt.tasks.all_states()
    requests = [r for r in evidence.records if r["kind"] == "scripted_request"]
    appended = [r for r in evidence.records if r["kind"] == "trajectory_append"]
    arrivals = [r for r in evidence.records if r["kind"] == "input_submitted"]
    check_results = {}

    def check(name, condition):
        check_results[name] = bool(condition)
        if not condition:
            raise AssertionError(name)

    check("startup_returns_id_before_result", any(
        r["kind"] == "observation" and r["label"] == "running_with_pending_update"
        and r["tasks"][0]["task_id"] == state.task_id
        and r["tasks"][0]["status"] == "running"
        and not r["tasks"][0]["result"] for r in evidence.records))
    query_request = next(r for r in requests if r["messages"][-1].get("content") == QUERY)
    check("deferred_update_absent_from_query_request", not any(
        m.get("content") == UPDATE for m in query_request["messages"]))
    query_output = next(r for r in appended if r["event"]["type"] == EventType.AGENT_OUTPUT
                        and "状态=running" in r["event"]["message"]["content"])
    terminal_log = next(r for r in evidence.records if r["kind"] == "log"
                        and r["source"] == "TASK"
                        and ("完成 ✅" in r["text"] or "子进程已终止" in r["text"]))
    check("query_answer_precedes_task_end", query_output["seq"] < terminal_log["seq"])
    check("real_child_process_exited", state.pid is not None
          and state._process is not None and state._process.returncode is not None)
    check("no_pending_input_left", not rt.pending)
    completion_events = [e for e in rt.trajectory if e.type == EventType.ASYNC_RESULT]
    if scenario == "cancel":
        check("cancelled_without_result", state.status == "cancelled"
              and 0 < state.progress < 100 and not state.result
              and state.returncode != 0 and not completion_events)
        check("no_final_analysis_after_cancel", not any("[脚本最终结果]" in o for o in outputs(rt)))
        check("interrupt_receipt_names_task", any(
            e.type == EventType.SYSTEM_NOTE and "['" + state.task_id + "']" in e.message["content"]
            for e in rt.trajectory))
    else:
        result = json.loads(state.result)
        check("completed_with_matching_task_id", state.status == "completed" and state.returncode == 0
              and len(completion_events) == 1 and completion_events[0].task_id == state.task_id)
        # Independent expectations for the five-line local fixture, not a call to worker.analyze().
        check("real_file_metrics", result["lines"] == 5 and result["heading_count"] == 2
              and result["experiment_mentions"] == 2 and result["async_mentions"] == 2
              and result["error_keyword_count"] == 2
              and result["input_sha256"] == hashlib.sha256(tasks.DEFAULT_INPUT.read_bytes()).hexdigest())
        final_request = next(r for r in requests if any(
            m.get("content", "").startswith("[系统事件｜异步任务完成]")
            for m in r["messages"]))
        check("completion_and_update_share_next_request", any(
            m.get("content") == UPDATE for m in final_request["messages"]))
        update_arrival = next(r for r in arrivals if r["text"] == UPDATE)
        update_append = next(r for r in appended if r["event"].get("message", {}).get("content") == UPDATE)
        check("received_before_finish_appended_after_finish",
              update_arrival["seq"] < terminal_log["seq"] < update_append["seq"])
        check("script_uses_real_result_and_format", f"[脚本最终结果] {state.task_id}：行数=5；标题数=2。" in outputs(rt))
        if scenario == "late-cancel":
            cancel_arrival = next(r for r in arrivals if r["text"] == "取消")
            final_append = next(r for r in appended if "[脚本最终结果]" in
                                r["event"].get("message", {}).get("content", ""))
            check("late_cancel_preserves_completed_result", final_append["seq"] < cancel_arrival["seq"]
                  and any(e.type == EventType.SYSTEM_NOTE and "（无）" in e.message["content"]
                          for e in rt.trajectory))
    return {"checks": check_results, "scripted_client_calls": client.calls,
            "real_llm_calls": 0, "task_id": state.task_id,
            "status": state.status, "progress": state.progress,
            "pid": state.pid, "returncode": state.returncode,
            "outputs": outputs(rt)}


async def run(scenario, cancel_at, destination):
    print(f"\n--- {scenario}：脚本化决策；真实子进程；无模型调用 ---", flush=True)
    evidence = Evidence()
    client = ScriptedClient(evidence)
    rt = ObservedRuntime(client, evidence)
    service = asyncio.create_task(rt.serve())
    result = {"scenario": scenario, "started_at_utc": evidence.started_at,
              "cancel_at": cancel_at if scenario == "cancel" else None}

    async def submit(text, urgency=None):
        evidence.add("input_submitted", text=text, urgency_override=urgency,
                     tasks=rt.tasks.snapshot())
        await rt.submit_user_message(text, urgency=urgency)

    try:
        await submit(START, urgency="immediate")
        await until(lambda: len(outputs(rt)) >= 1 and rt.tasks.all_states()
                    and rt.tasks.all_states()[0].progress >= 22.5, service, "first progress")
        state, = rt.tasks.all_states()
        if state.status != "running":
            raise AssertionError("Missed running window; no valid mid-task evidence")
        await submit(UPDATE)
        await until(lambda: len(rt.pending) == 1, service, "deferred input buffered")
        evidence.add("observation", label="running_with_pending_update", tasks=rt.tasks.snapshot(),
                     pending=[e.to_dict() for e in rt.pending])
        await submit(QUERY)
        await until(lambda: any("状态=running" in o for o in outputs(rt)), service, "query response")
        if scenario == "cancel":
            await until(lambda: state.progress >= cancel_at, service, "cancel threshold")
            if state.status != "running":
                raise AssertionError("Task finished before the selected cancellation point")
            await submit("取消")
        else:
            await until(lambda: any("[脚本最终结果]" in o for o in outputs(rt)), service, "final response")
            if scenario == "late-cancel":
                await submit("取消")
        await rt.wait_until_idle(stable=0.2, timeout=5)
        if service.done():
            await service
        result.update(verify(rt, evidence, scenario, client))
        result["passed"] = True
    except Exception as exc:
        result.update(passed=False, error=f"{type(exc).__name__}: {exc}",
                      scripted_client_calls=client.calls, real_llm_calls=0)
        raise
    finally:
        # Always reap children, including a failed scenario. stop() alone does not do this.
        rt.tasks.cancel_all()
        await asyncio.gather(*(s._task for s in rt.tasks.all_states() if s._task), return_exceptions=True)
        await rt.stop()
        await asyncio.gather(service, return_exceptions=True)
        result["elapsed_s"] = round(time.monotonic() - evidence.t0, 3)
        result["tasks"] = rt.tasks.snapshot()
        result["trajectory"] = [e.to_dict() for e in rt.trajectory]
        destination.mkdir(parents=True, exist_ok=True)
        (destination / f"{scenario}.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
        (destination / f"{scenario}.jsonl").write_text("".join(
            json.dumps(r, ensure_ascii=False) + "\n" for r in evidence.records))
        (destination / f"{scenario}.log").write_text("\n".join(
            f"[{r['elapsed_s']:6.3f}s] {r['source']:6} | {r['text']}"
            for r in evidence.records if r["kind"] == "log") + "\n")
    print(f"PASS {scenario}: {result['status']}; checks={len(result['checks'])}; scripted calls={client.calls}")
    return result


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario", choices=["all", "complete", "cancel", "late-cancel"], default="all")
    parser.add_argument("--cancel-at", type=float, default=40, help="cancel scenario: progress threshold (30–80)")
    parser.add_argument("--output", type=Path, help="new evidence directory; existing paths are rejected")
    args = parser.parse_args()
    if not 30 <= args.cancel_at <= 80:
        parser.error("--cancel-at must be between 30 and 80")
    destination = args.output or HERE / "runs" / datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    destination.mkdir(parents=True, exist_ok=False)
    manifest = json.loads((HERE / "upstream-manifest.json").read_text())
    for entry in manifest["files"]:
        expected = entry.get("local_sha256", entry["sha256"])
        if hashlib.sha256((HERE / entry["path"]).read_bytes()).hexdigest() != expected:
            raise AssertionError("Local source hash mismatch: " + entry["path"])
    # Explicit local configuration; official execution logic is unchanged.
    tasks.DEFAULT_INPUT = HERE / "fixtures" / "sample.md"
    tasks.TICK_REAL = 0.15
    scenarios = ["complete", "cancel", "late-cancel"] if args.scenario == "all" else [args.scenario]
    results = [await run(name, args.cancel_at, destination) for name in scenarios]
    summary = {"python": sys.version, "upstream_commit": manifest["commit"],
               "source_hashes_verified": True,
               "upstream_files_unmodified": manifest["upstream_files_unmodified"],
               "source_files": manifest["files"], "real_llm_calls": 0,
               "scripted_client_calls": sum(r["scripted_client_calls"] for r in results),
               "scenarios": [{k: r[k] for k in ("scenario", "passed", "task_id", "status", "progress", "elapsed_s")}
                             for r in results]}
    (destination / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    print(f"\n证据目录：{destination.resolve()}\n真实模型调用：0；脚本客户端调用：{summary['scripted_client_calls']}")


if __name__ == "__main__":
    asyncio.run(main())
