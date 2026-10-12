export class DataParseError extends Error {
  constructor(
    message: string,
    readonly sourcePath?: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "DataParseError";
  }
}
