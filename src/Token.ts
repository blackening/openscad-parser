import CodeLocation from "./CodeLocation";
import { ExtraToken } from "./extraTokens";
import TokenType from "./TokenType";

export default class Token {
  /**
   * All the newlines and comments that appear before this token and should be preserved when printing the AST.
   */
  public extraTokens: ExtraToken[] = [];

  constructor(
    public type: TokenType,
    public pos: CodeLocation,
    public lexeme: string
  ) {}

  toString(): string {
    return `token ${TokenType[this.type]} ${this.pos.toString()}`;
  }
}
