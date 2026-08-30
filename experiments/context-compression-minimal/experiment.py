from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable


SYSTEM_PROMPT = """SAFETY: Do not access the external network without user permission.
RULE: Preserve exact identifiers without rewriting them."""

HARD_CONSTRAINT = "Do not access the external network for this task."
ORDER_ID = "ORD-2026-0830"
FAILED_ACTION = "web_search"
FAILURE_REASON = "missing API key"
CURRENT_TODO = "Check whether the order satisfies the refund conditions."
EVIDENCE = "A refund is allowed within 7 days of delivery."
EVIDENCE_SOURCE = "doc://refund-policy-v3"


@dataclass(frozen=True)
class Message:
    role: str
    content: str

    def render(self) -> str:
        return f"[{self.role.upper()}]\n{self.content}"


@dataclass(frozen=True)
class CheckResult:
    name: str
    passed: bool
    detail: str


@dataclass(frozen=True)
class StrategyResult:
    strategy: str
    rendered_context: str
    character_count: int
    rough_token_estimate: int
    compression_ratio: float
    checks: list[CheckResult]
    retention_passed: bool
    size_reduction_passed: bool
    passes_all_conditions: bool


def build_scenario() -> list[Message]:
    noisy_tool_result = "\n".join(
        [
            f"SOURCE: {EVIDENCE_SOURCE}",
            EVIDENCE,
            *(f"navigation footer repeated content block {index:03d}" for index in range(420)),
        ]
    )

    messages = [
        Message("system", SYSTEM_PROMPT),
        Message(
            "user",
            f"HARD_CONSTRAINT: {HARD_CONSTRAINT}\nORDER_ID: {ORDER_ID}",
        ),
        Message(
            "assistant",
            "Plan: read the local refund policy, check eligibility, then ask for confirmation.",
        ),
        Message("tool", noisy_tool_result),
        Message(
            "assistant",
            'TOOL_CALL id=call_web_1 name=web_search arguments={"query":"refund policy"}',
        ),
        Message(
            "tool",
            f"tool_call_id=call_web_1 ERROR: {FAILED_ACTION} failed because of a {FAILURE_REASON}.",
        ),
        Message(
            "assistant",
            f"FAILED_ATTEMPT: {FAILED_ACTION} failed because of a {FAILURE_REASON}; do not retry it.",
        ),
    ]

    for index in range(1, 7):
        messages.extend(
            [
                Message("user", f"Unrelated small-talk message {index}."),
                Message("assistant", f"Unrelated small-talk response {index}."),
            ]
        )

    messages.extend(
        [
            Message("user", "Continue processing the refund request."),
            Message("user", f"CURRENT_TODO: {CURRENT_TODO}"),
        ]
    )
    return messages


def render_messages(messages: list[Message]) -> str:
    return "\n\n".join(message.render() for message in messages)


def no_compression(messages: list[Message]) -> str:
    return render_messages(messages)


def sliding_window(messages: list[Message], window_size: int = 4) -> str:
    system_messages = [message for message in messages if message.role == "system"]
    trajectory = [message for message in messages if message.role != "system"]
    return render_messages(system_messages + trajectory[-window_size:])


def task_aware_structured_compression(messages: list[Message]) -> str:
    del messages  # The minimal lab uses a deterministic, pre-defined extraction schema.
    state = {
        "hard_constraints": [
            {
                "text": HARD_CONSTRAINT,
                "source": "user",
                "status": "active",
            }
        ],
        "exact_identifiers": {"order_id": ORDER_ID},
        "completed_steps": ["Read the local refund policy."],
        "current_todo": [CURRENT_TODO],
        "failed_attempts": [
            {
                "action": FAILED_ACTION,
                "reason": FAILURE_REASON,
                "retry": False,
            }
        ],
        "evidence": [{"fact": EVIDENCE, "source": EVIDENCE_SOURCE}],
        "archived_content": [
            {
                "kind": "large_tool_result",
                "source": EVIDENCE_SOURCE,
                "runtime_status": "removed_after_extraction",
            }
        ],
    }
    state_message = Message(
        "user",
        "<agent_status>\n"
        + json.dumps(state, ensure_ascii=False, indent=2)
        + "\n</agent_status>",
    )
    current_request = Message("user", "Continue processing the refund request.")
    return render_messages(
        [Message("system", SYSTEM_PROMPT), state_message, current_request]
    )


def rough_token_estimate(text: str) -> int:
    """A dependency-free estimate for this mostly-English fixture, not provider billing data."""
    return math.ceil(len(text) / 4)


def evaluate_retention(context: str) -> list[CheckResult]:
    checks = [
        CheckResult(
            "hard_constraint",
            HARD_CONSTRAINT in context,
            "The active no-network constraint must remain visible.",
        ),
        CheckResult(
            "exact_identifier",
            ORDER_ID in context,
            "The order identifier must remain byte-for-byte identical.",
        ),
        CheckResult(
            "failed_path",
            FAILED_ACTION in context
            and FAILURE_REASON in context
            and ("do not retry" in context or '"retry": false' in context),
            "The failed action, reason, and no-retry decision must remain visible.",
        ),
        CheckResult(
            "current_todo",
            CURRENT_TODO in context,
            "The current task state must remain visible.",
        ),
        CheckResult(
            "evidence",
            EVIDENCE in context,
            "The task-relevant fact must remain visible.",
        ),
        CheckResult(
            "source",
            EVIDENCE_SOURCE in context,
            "The retained fact must remain traceable to its source.",
        ),
        CheckResult(
            "system_prompt",
            context.startswith("[SYSTEM]\n" + SYSTEM_PROMPT),
            "The stable system prompt must remain unchanged at the front.",
        ),
    ]
    return checks


def run_strategy(
    name: str,
    strategy: Callable[[list[Message]], str],
    messages: list[Message],
    baseline_character_count: int,
) -> StrategyResult:
    context = strategy(messages)
    character_count = len(context)
    compression_ratio = character_count / baseline_character_count
    checks = evaluate_retention(context)
    retention_passed = all(check.passed for check in checks)
    size_reduction_passed = compression_ratio <= 0.5
    return StrategyResult(
        strategy=name,
        rendered_context=context,
        character_count=character_count,
        rough_token_estimate=rough_token_estimate(context),
        compression_ratio=compression_ratio,
        checks=checks,
        retention_passed=retention_passed,
        size_reduction_passed=size_reduction_passed,
        passes_all_conditions=retention_passed and size_reduction_passed,
    )


def run_experiment() -> list[StrategyResult]:
    messages = build_scenario()
    baseline_context = no_compression(messages)
    baseline_character_count = len(baseline_context)
    strategies: list[tuple[str, Callable[[list[Message]], str]]] = [
        ("no_compression", no_compression),
        ("sliding_window", sliding_window),
        ("task_aware_structured", task_aware_structured_compression),
    ]
    return [
        run_strategy(name, strategy, messages, baseline_character_count)
        for name, strategy in strategies
    ]


def save_results(results: list[StrategyResult]) -> Path:
    runs_dir = Path(__file__).parent / "runs"
    runs_dir.mkdir(exist_ok=True)
    output_path = runs_dir / "latest.json"
    output_path.write_text(
        json.dumps([asdict(result) for result in results], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return output_path


def print_results(results: list[StrategyResult]) -> None:
    print(
        f"{'strategy':<26} {'chars':>8} {'rough_tok':>10} "
        f"{'ratio':>8} {'retain':>8} {'size':>8} {'all':>8}"
    )
    for result in results:
        print(
            f"{result.strategy:<26} "
            f"{result.character_count:>8} "
            f"{result.rough_token_estimate:>10} "
            f"{result.compression_ratio:>7.1%} "
            f"{str(result.retention_passed):>8} "
            f"{str(result.size_reduction_passed):>8} "
            f"{str(result.passes_all_conditions):>8}"
        )
        failed = [check.name for check in result.checks if not check.passed]
        if failed:
            print(f"  failed checks: {', '.join(failed)}")


if __name__ == "__main__":
    experiment_results = run_experiment()
    print_results(experiment_results)
    saved_path = save_results(experiment_results)
    print(f"\nTrace saved to: {saved_path}")
