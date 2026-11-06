import { describe, expect, it } from "vitest";
import { describeTerm, formatSearch, parseSearch, quoteValue, safeParse } from "./searchFilter";

describe("searchFilter", () => {
  it("parses fields, OR values, negation, quotes and comparisons like the server", () => {
    expect(parseSearch('ip:45.* country:CN,RU -user:root cmd:"wget http,x" dur>=5m protocol:telnet')).toEqual([
      { field: "ip", op: ":", values: ["45.*"], negate: false },
      { field: "country", op: ":", values: ["CN", "RU"], negate: false },
      { field: "user", op: ":", values: ["root"], negate: true },
      { field: "cmd", op: ":", values: ["wget http,x"], negate: false },
      { field: "dur", op: ">=", values: ["5m"], negate: false },
      { field: "proto", op: ":", values: ["telnet"], negate: false },
    ]);
  });

  it("reads bare words as an IP or a command fragment", () => {
    expect(parseSearch("203.0.113.5 45.* wget -busybox http://x/y.sh").map((t) => [t.field, t.negate, t.values[0]])).toEqual([
      ["ip", false, "203.0.113.5"],
      ["ip", false, "45.*"],
      ["cmd", false, "wget"],
      ["cmd", true, "busybox"],
      ["cmd", false, "http://x/y.sh"],
    ]);
  });

  it.each([
    ["foo:bar", "champ inconnu"],
    ['cmd:"open', "guillemet"],
    ["dur:60", "dur"],
    ["user>3", "seul dur"],
    ["login:maybe", "login"],
    ["file:zz", "file"],
    ["country:CN,", "vide"],
  ])("rejects %s", (text, message) => {
    expect(safeParse(text).error).toContain(message);
  });

  it("formats back to a text that parses the same", () => {
    const text = 'country:CN,RU -cmd:"uname -a" pass:"a\\"b" dur<1h';
    const terms = parseSearch(text);
    expect(formatSearch(terms)).toBe(text);
    expect(parseSearch(formatSearch(terms))).toEqual(terms);
    expect(quoteValue("root")).toBe("root");
    expect(quoteValue("a,b")).toBe('"a,b"');
  });

  it("describes terms for the chips", () => {
    const [country, cmd, dur, login, file] = parseSearch("country:CN,RU -cmd:wget dur>60 login:ok file:upload");
    expect(describeTerm(country)).toEqual({ field: "Pays", op: "est", value: "CN ou RU" });
    expect(describeTerm(cmd)).toEqual({ field: "Commande", op: "ne contient pas", value: "wget" });
    expect(describeTerm(dur)).toEqual({ field: "Durée", op: ">", value: "60 s" });
    expect(describeTerm(login).value).toBe("accepté");
    expect(describeTerm(file).value).toBe("déposé");
  });
});
