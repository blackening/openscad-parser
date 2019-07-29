import CodeFile from "./CodeFile";
import Token from "./Token";
import TokenType from "./TokenType";
import ParsingError from "./ParsingError";
import {
  Statement,
  UseStmt,
  NoopStmt,
  BlockStmt,
  ModuleDeclarationStmt,
  FunctionDeclarationStmt,
  ModuleInstantiationStmt
} from "./ast/statements";
import ScadFile from "./ast/ScadFile";
import CodeLocation from "./CodeLocation";
import AssignmentNode from "./ast/AssignmentNode";
import LiteralToken from "./LiteralToken";
import {
  Expression,
  LiteralExpr,
  Lookup,
  GroupingExpr
} from "./ast/expressions";

const moduleInstantiationTagTokens = [
  TokenType.Bang,
  TokenType.Hash,
  TokenType.Percent,
  TokenType.Star
];

export default class Parser {
  protected currentToken = 0;
  constructor(public code: CodeFile, public tokens: Token[]) {}

  parse() {
    const statements: Statement[] = [];
    while (!this.isAtEnd()) {
      if (this.matchToken(TokenType.Use)) {
        const beginning = this.consume(
          TokenType.Less,
          "Expected '<' after use"
        );
        while (!this.checkToken(TokenType.Greater) && !this.isAtEnd()) {
          this.advance();
        }
        if (this.isAtEnd()) {
          throw new ParsingError(
            this.getLocation(),
            "Unterminated 'use' statement"
          );
        }
        const filename = this.code.code.substring(
          beginning.pos.char,
          this.previous().pos.char
        );
        statements.push(new UseStmt(this.getLocation(), filename));
      } else {
        statements.push(this.statement());
      }
    }
    return new ScadFile(new CodeLocation(this.code), statements);
  }

  protected statement() {
    if (this.matchToken(TokenType.Semicolon)) {
      return new NoopStmt(this.getLocation());
    }
    if (this.matchToken(TokenType.LeftBrace)) {
      return this.blockStatement();
    }
    if (this.matchToken(TokenType.Module)) {
      return this.moduleDeclarationStatement();
    }
    if (this.matchToken(TokenType.Function)) {
      return this.functionDeclarationStatement();
    }
    const assignmentOrInst = this.matchAssignmentOrModuleInstantation();
    if (assignmentOrInst) {
      return assignmentOrInst;
    }
    this.advance();
  }
  protected matchAssignmentOrModuleInstantation() {
    // identifiers can mean either an instantiation is incoming or an assignment
    if (this.matchToken(TokenType.Identifier)) {
      if (this.peek().type === TokenType.Equal) {
        return this.assignmentStatement();
      }
      if (this.peek().type === TokenType.LeftParen) {
        return this.moduleInstantiationStatement();
      }
      throw new ParsingError(
        this.getLocation(),
        `Unexpected token ${this.peek()} after identifier in statement.`
      );
    }
    if (this.matchToken(...moduleInstantiationTagTokens)) {
      return this.moduleInstantiationStatement();
    }
    return null;
  }

  protected blockStatement() {
    const startLocation = this.getLocation();
    const innerStatements: Statement[] = [];
    while (!this.checkToken(TokenType.RightBrace) && !this.isAtEnd()) {
      innerStatements.push(this.statement());
    }
    this.consume(TokenType.RightBrace, "Expected '}' after block statement");
    return new BlockStmt(startLocation, innerStatements);
  }
  protected moduleDeclarationStatement(): ModuleDeclarationStmt {
    const nameToken = this.consume(
      TokenType.Identifier,
      "Expected module name after 'module' keyword"
    );
    this.consume(TokenType.LeftParen, "Expected '(' after module name");
    const args: AssignmentNode[] = this.args();
    const body = this.statement();
    return new ModuleDeclarationStmt(
      this.getLocation(),
      (nameToken as LiteralToken<string>).value,
      args,
      body
    );
  }
  protected functionDeclarationStatement(): FunctionDeclarationStmt {
    const nameToken = this.consume(
      TokenType.Identifier,
      "Expected function name after 'function' keyword"
    );
    this.consume(TokenType.LeftParen, "Expected '(' after function name");
    const args = this.args();
    this.consume(TokenType.Equal, "Expected '=' after function parameters");
    const body = this.expression();
    this.consume(
      TokenType.Semicolon,
      "Expected ';' after function declaration"
    );
    return new FunctionDeclarationStmt(
      this.getLocation(),
      (nameToken as LiteralToken<string>).value,
      args,
      body
    );
  }
  protected assignmentStatement() {
    const pos = this.getLocation();
    const name = this.previous() as LiteralToken<string>;
    this.consume(TokenType.Equal, "Expected '=' after assignment name.");
    const expr = this.expression();
    this.consume(
      TokenType.Semicolon,
      "Expected ';' after assignment statement."
    );
    return new AssignmentNode(pos, name.value, expr);
  }
  protected moduleInstantiationStatement(): ModuleInstantiationStmt {
    if (this.previous().type === TokenType.Bang) {
      this.advance();
      const mod = this.moduleInstantiationStatement();
      mod.tagRoot = true;
      return mod;
    }
    if (this.previous().type === TokenType.Hash) {
      this.advance();
      const mod = this.moduleInstantiationStatement();
      mod.tagHighlight = true;
      return mod;
    }
    if (this.previous().type === TokenType.Percent) {
      this.advance();
      const mod = this.moduleInstantiationStatement();
      mod.tagBackground = true;
      return mod;
    }
    if (this.previous().type === TokenType.Star) {
      this.advance();
      const mod = this.moduleInstantiationStatement();
      mod.tagDisabled = true;
      return mod;
    }
    const mod = this.singleModuleInstantiation();
    mod.child = this.statement();
    return mod;
  }
  protected singleModuleInstantiation() {
    const name = this.previous() as LiteralToken<string>;
    this.consume(
      TokenType.LeftParen,
      "Expected '(' after module instantation."
    );
    const args = this.args(true);
    return new ModuleInstantiationStmt(name.pos, name.value, args, null);
  }

  protected args(allowPositional = false): AssignmentNode[] {
    this.consumeUselessCommas();
    const args: AssignmentNode[] = [];
    if (this.matchToken(TokenType.RightParen)) {
      return args;
    }
    while (true) {
      if (this.isAtEnd()) {
        break;
      }
      if (!allowPositional && this.peek().type !== TokenType.Identifier) {
        break;
      }
      let value: Expression = null;
      let name: string;
      if (!allowPositional || this.peekNext().type === TokenType.Equal) {
        // this is a named parameter
        name = (this.advance() as LiteralToken<string>).value;
        // a value is provided for this param
        if (this.matchToken(TokenType.Equal)) {
          value = this.expression();
        }
      } else {
        name = "";
        value = this.expression();
        // this is a positional paramater
      }

      const arg = new AssignmentNode(this.getLocation(), name, value);
      args.push(arg);

      if (this.matchToken(TokenType.Comma)) {
        this.consumeUselessCommas();
        if (this.matchToken(TokenType.RightParen)) {
          return args;
        }
        continue;
      }
      this.consumeUselessCommas();
      // end of named arguments
      if (this.matchToken(TokenType.RightParen)) {
        return args;
      }
    }
    if (this.isAtEnd()) {
      throw new ParsingError(
        this.getLocation(),
        `Unterminated parameters list.`
      );
    }
    throw new ParsingError(
      this.getLocation(),
      `Unexpected token ${this.advance()} in named arguments list.`
    );
  }
  protected consumeUselessCommas() {
    while (this.matchToken(TokenType.Comma) && !this.isAtEnd()) {}
  }
  protected expression(): Expression {
    return this.primary();
  }

  protected primary() {
    if (this.matchToken(TokenType.True)) {
      return new LiteralExpr(this.getLocation(), true);
    }
    if (this.matchToken(TokenType.False)) {
      return new LiteralExpr(this.getLocation(), false);
    }
    if (this.matchToken(TokenType.Undef)) {
      return new LiteralExpr(this.getLocation(), null);
    }
    if (this.matchToken(TokenType.NumberLiteral)) {
      return new LiteralExpr(
        this.getLocation(),
        (this.previous() as LiteralToken<number>).value
      );
    }
    if (this.matchToken(TokenType.StringLiteral)) {
      return new LiteralExpr(
        this.getLocation(),
        (this.previous() as LiteralToken<string>).value
      );
    }
    if (this.matchToken(TokenType.Identifier)) {
      return new Lookup(
        this.getLocation(),
        (this.previous() as LiteralToken<string>).value
      );
    }
    if (this.matchToken(TokenType.LeftParen)) {
      const expr = this.expression();
      this.consume(
        TokenType.RightParen,
        "Expected ')' after grouping expression."
      );
      return new GroupingExpr(this.getLocation(), expr);
    }
    throw new ParsingError(
      this.getLocation(),
      "Failed to match primary expression."
    );
  }

  protected consume(tt: TokenType, errorMessage: string) {
    if (this.checkToken(tt)) {
      return this.advance();
    }
    throw new ParsingError(this.getLocation(), errorMessage);
  }
  protected matchToken(...toMatch: TokenType[]) {
    for (const tt of toMatch) {
      if (this.checkToken(tt)) {
        this.advance();
        return true;
      }
    }
    return false;
  }
  protected checkToken(tt: TokenType) {
    if (this.isAtEnd()) {
      return false;
    }
    return this.peek().type == tt;
  }
  protected advance() {
    if (!this.isAtEnd()) {
      this.currentToken++;
    }
    return this.previous();
  }
  protected isAtEnd() {
    return this.peek().type === TokenType.Eot;
  }
  protected peek(): Token {
    return this.tokens[this.currentToken];
  }
  protected peekNext(): Token {
    if (this.tokens[this.currentToken].type === TokenType.Eot) {
      return this.tokens[this.currentToken];
    }
    return this.tokens[this.currentToken + 1];
  }
  protected getLocation() {
    return this.peek().pos;
  }
  protected previous(): Token {
    return this.tokens[this.currentToken - 1];
  }
}
