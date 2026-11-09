import { describe, expect, it } from "bun:test";

import {
  EMPTY_REACTIONS,
  MAX_REACTION_ENTRIES,
  forgetReactions,
  parseReactions,
  serializeReactions,
  toggleReaction,
} from "./sms-reactions";

describe("toggleReaction", () => {
  it("adds a reaction and reports it on", () => {
    const { map, on } = toggleReaction(EMPTY_REACTIONS, "a", "heart", 10);
    expect(on).toBe(true);
    expect(map.get("a")).toEqual({ r: ["heart"] });
  });

  it("removes it again and drops the empty entry", () => {
    const first = toggleReaction(EMPTY_REACTIONS, "a", "star", 10).map;
    const { map, on } = toggleReaction(first, "a", "star", 11);
    expect(on).toBe(false);
    expect(map.has("a")).toBe(false);
  });

  it("keeps canonical order whatever the click order", () => {
    let map = toggleReaction(EMPTY_REACTIONS, "a", "pin", 1).map;
    map = toggleReaction(map, "a", "heart", 2).map;
    map = toggleReaction(map, "a", "memo", 3).map;
    expect(map.get("a")?.r).toEqual(["heart", "memo", "pin"]);
  });

  it("stamps the pin time and keeps it when another reaction changes", () => {
    let map = toggleReaction(EMPTY_REACTIONS, "a", "pin", 100).map;
    map = toggleReaction(map, "a", "heart", 200).map;
    expect(map.get("a")?.p).toBe(100);
    map = toggleReaction(map, "a", "heart", 300).map;
    expect(map.get("a")?.p).toBe(100);
  });

  it("clears the pin time on unpin and restamps on a later pin", () => {
    let map = toggleReaction(EMPTY_REACTIONS, "a", "pin", 100).map;
    map = toggleReaction(map, "a", "heart", 150).map;
    map = toggleReaction(map, "a", "pin", 200).map;
    expect(map.get("a")).toEqual({ r: ["heart"] });
    map = toggleReaction(map, "a", "pin", 300).map;
    expect(map.get("a")?.p).toBe(300);
  });

  it("never mutates the map it was given", () => {
    const before = toggleReaction(EMPTY_REACTIONS, "a", "heart", 1).map;
    const snapshot = serializeReactions(before);
    toggleReaction(before, "a", "star", 2);
    expect(serializeReactions(before)).toBe(snapshot);
  });

  it("drops the least recently touched entry past the cap", () => {
    let map = EMPTY_REACTIONS;
    for (let i = 0; i < MAX_REACTION_ENTRIES; i++) {
      map = toggleReaction(map, `m${i}`, "heart", i).map;
    }
    // Touch the oldest so it becomes the newest.
    map = toggleReaction(map, "m0", "star", 999).map;
    map = toggleReaction(map, "extra", "heart", 1000).map;
    expect(map.size).toBe(MAX_REACTION_ENTRIES);
    expect(map.has("m0")).toBe(true);
    expect(map.has("m1")).toBe(false);
    expect(map.has("extra")).toBe(true);
  });
});

describe("eviction", () => {
  it("never evicts a pinned message, even the oldest", () => {
    let map = toggleReaction(EMPTY_REACTIONS, "pinned", "pin", 1).map;
    for (let i = 0; i < MAX_REACTION_ENTRIES + 5; i++) {
      map = toggleReaction(map, `m${i}`, "heart", 10 + i).map;
    }
    expect(map.has("pinned")).toBe(true);
    expect(map.size).toBe(MAX_REACTION_ENTRIES);
  });
});

describe("forgetReactions", () => {
  it("removes one entry and returns the same map when absent", () => {
    const map = toggleReaction(EMPTY_REACTIONS, "a", "heart", 1).map;
    expect(forgetReactions(map, "a").has("a")).toBe(false);
    expect(forgetReactions(map, "zzz")).toBe(map);
  });
});

describe("serialize / parse", () => {
  it("round-trips, including insertion order of integer-looking keys", () => {
    let map = EMPTY_REACTIONS;
    map = toggleReaction(map, "9", "heart", 1).map;
    map = toggleReaction(map, "10", "pin", 2).map;
    map = toggleReaction(map, "abc", "memo", 3).map;
    const back = parseReactions(serializeReactions(map));
    expect([...back.keys()]).toEqual(["9", "10", "abc"]);
    expect(back.get("10")).toEqual({ r: ["pin"], p: 2 });
  });

  it("survives garbage without throwing", () => {
    expect(parseReactions(null)).toBe(EMPTY_REACTIONS);
    expect(parseReactions("not json")).toBe(EMPTY_REACTIONS);
    expect(parseReactions('{"a":1}')).toBe(EMPTY_REACTIONS);
  });

  it("skips bad rows and unknown kinds but keeps good ones", () => {
    const raw = JSON.stringify([
      ["ok", { r: ["star", "bogus"] }],
      ["bad-kinds", { r: ["bogus"] }],
      ["no-entry", null],
      [42, { r: ["heart"] }],
      ["unpinned-stamp", { r: ["heart"], p: 5 }],
      ["pinned-no-stamp", { r: ["pin"] }],
    ]);
    const map = parseReactions(raw);
    expect([...map.keys()]).toEqual(["ok", "unpinned-stamp", "pinned-no-stamp"]);
    expect(map.get("ok")).toEqual({ r: ["star"] });
    expect(map.get("unpinned-stamp")).toEqual({ r: ["heart"] });
    expect(map.get("pinned-no-stamp")).toEqual({ r: ["pin"] });
  });
});
