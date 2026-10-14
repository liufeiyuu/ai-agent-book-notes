// 由可信工具实现报告的已知错误，不根据模型字段或错误文案猜测是否重试。
// 只在确认尚未产生副作用、原样重试安全时使用这个暂时错误。
export class TemporaryToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemporaryToolError";
  }
}

export class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionDeniedError";
  }
}
