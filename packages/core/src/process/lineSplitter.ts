export interface LineSplitter {
  push(chunk: string): void;
  flush(): void;
}

/**
 * 把任意切分的字节流还原成行。空行不产生事件，CRLF 与 LF 等价。
 */
export function createLineSplitter(onLine: (line: string) => void): LineSplitter {
  let buffer = "";

  const emit = (raw: string) => {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line !== "") onLine(line);
  };

  return {
    push(chunk: string): void {
      buffer += chunk;
      let index = buffer.indexOf("\n");
      while (index !== -1) {
        emit(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf("\n");
      }
    },
    flush(): void {
      if (buffer !== "") {
        emit(buffer);
        buffer = "";
      }
    },
  };
}
