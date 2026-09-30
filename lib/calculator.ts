class ArithmeticParser {
  private position = 0;

  constructor(private readonly input: string) { }

  parse(): number {
    const value = this.parseSum();
    this.skipWhitespace();
    if (this.position !== this.input.length || !Number.isFinite(value)) {
      throw new Error("Invalid arithmetic expression.");
    }
    return value;
  }

  private parseSum(): number {
    let value = this.parseProduct();
    while (true) {
      this.skipWhitespace();
      const operator = this.input[this.position];
      if (operator !== "+" && operator !== "-") return value;
      this.position++;
      const right = this.parseProduct();
      value = operator === "+" ? value + right : value - right;
    }
  }

  private parseProduct(): number {
    let value = this.parseUnary();
    while (true) {
      this.skipWhitespace();
      const operator = this.input[this.position];
      if (operator !== "*" && operator !== "/") return value;
      this.position++;
      const right = this.parseUnary();
      if (operator === "/" && right === 0) {
        throw new Error("Division by zero.");
      }
      value = operator === "*" ? value * right : value / right;
    }
  }

  private parseUnary(): number {
    this.skipWhitespace();
    const operator = this.input[this.position];
    if (operator === "+" || operator === "-") {
      this.position++;
      const value = this.parseUnary();
      return operator === "-" ? -value : value;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    this.skipWhitespace();
    if (this.input[this.position] === "(") {
      this.position++;
      const value = this.parseSum();
      this.skipWhitespace();
      if (this.input[this.position] !== ")") {
        throw new Error("Unclosed parenthesis.");
      }
      this.position++;
      return value;
    }

    const match = this.input.slice(this.position).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if (!match) throw new Error("Expected a number.");
    this.position += match[0].length;
    return Number(match[0]);
  }

  private skipWhitespace() {
    while (/\s/.test(this.input[this.position] || "")) this.position++;
  }
}

export function calculate(expression: string): number {
  if (!expression.trim() || expression.length > 200) {
    throw new Error("Expression must contain at most 200 characters.");
  }
  return new ArithmeticParser(expression).parse();
}