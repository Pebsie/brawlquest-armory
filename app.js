"use strict";

const TYPE_LABEL = {
  wep: "Weapon",
  reagent: "Reagent",
  mount: "Mount",
  arm_head: "Head armour",
  arm_chest: "Chest armour",
  spell: "Spell",
  arm_legs: "Leg armour",
  furniture: "Furniture",
  buddy: "Buddy",
  quest: "Quest",
  currency: "Currency",
  hp_potion: "Health potion",
  shield: "Shield",
  ore: "Ore",
  mana_potion: "Mana potion",
  floor: "Floor",
  wall: "Wall",
};

const SLOT_ORDER = [
  ["headId", "Head armour"],
  ["chestId", "Chest armour"],
  ["legsId", "Leg armour"],
  ["weaponId", "Weapon"],
  ["shieldId", "Shield"],
];

let DB = null;
const byId = { items: new Map(), mobs: new Map(), sets: new Map(), characters: new Map() };
let charShown = 80;
let searchTimer = 0;

const main = () => document.getElementById("main");

function num(n) {
  if (n === null || n === undefined || n === "") return "—";
  const value = Number(n);
  if (!Number.isFinite(value)) return esc(String(n));
  return value.toLocaleString("en-GB");
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function lower(s) {
  return String(s ?? "").toLocaleLowerCase("en-GB");
}

function imgUrl(path) {
  if (!path) return "";
  return path.split("/").map(encodeURIComponent).join("/");
}

function icon(itemOrPath, missing, large) {
  const path = typeof itemOrPath === "string" ? itemOrPath : itemOrPath && itemOrPath.img;
  const gone = typeof itemOrPath === "string" ? missing : (missing || (itemOrPath && itemOrPath.imgMissing) || !path);
  const cls = large ? "lg" : "";
  if (gone || !path) {
    return `<span class="ph ${cls}" role="img" aria-label="No image">No image</span>`;
  }
  const size = large ? 96 : 64;
  return `<img class="icon ${cls}" alt="" width="${size}" height="${size}" src="${esc(imgUrl(path))}">`;
}

function typeLabel(type) {
  return TYPE_LABEL[type] || type || "Unknown";
}

function attrText(attrs) {
  if (!attrs || !attrs.length) return "No attributes";
  return attrs.map((a) => (a.value === null || a.value === undefined ? a.stat : `${a.stat} ${a.value}`)).join(", ");
}

function rank(name, q) {
  const n = lower(name);
  const query = lower(q);
  if (!query) return 0;
  if (n === query) return 0;
  if (n.startsWith(query)) return 1;
  if (n.includes(query)) return 2;
  return 9;
}

function parseRoute() {
  const raw = (location.hash || "#/").replace(/^#/, "") || "/";
  const cut = raw.indexOf("?");
  const path = cut === -1 ? raw : raw.slice(0, cut);
  const params = new URLSearchParams(cut === -1 ? "" : raw.slice(cut + 1));
  const parts = path.split("/").filter(Boolean);
  return { parts, params, path: "/" + parts.join("/") };
}

function href(path) {
  return "#" + path;
}

function setNav(section) {
  document.querySelectorAll(".nav a").forEach((a) => {
    const on = a.getAttribute("href") === "#/" + section;
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

function replaceHash(path) {
  const next = "#" + path;
  if (location.hash !== next) history.replaceState(null, "", next);
}

document.body.addEventListener("error", (event) => {
  const target = event.target;
  if (!target || target.tagName !== "IMG") return;
  const ph = document.createElement("span");
  ph.className = "ph" + (target.classList.contains("lg") ? " lg" : "");
  ph.textContent = "No image";
  target.replaceWith(ph);
}, true);

async function boot() {
  const view = main();
  view.innerHTML = "<p>Loading the catalogue…</p>";
  try {
    const res = await fetch("data/armory.json");
    if (!res.ok) throw new Error("Catalogue failed to load (" + res.status + ").");
    DB = await res.json();
  } catch (err) {
    view.innerHTML = `<p class="err">${esc(err.message || "Could not load the catalogue.")}</p>`;
    return;
  }
  for (const item of DB.items) byId.items.set(item.id, item);
  for (const mob of DB.mobs) byId.mobs.set(mob.id, mob);
  for (const set of DB.sets) byId.sets.set(set.id, set);
  for (const ch of DB.characters) byId.characters.set(ch.id, ch);
  window.addEventListener("hashchange", () => render(true));
  render(true);
}

function render(scroll) {
  const route = parseRoute();
  const section = route.parts[0] || "";
  setNav(section === "item" ? "items" : section === "mob" ? "mobs" : section === "set" ? "sets" : section === "character" ? "characters" : section);
  const keepFocus = document.activeElement && document.activeElement.id === "q"
    ? document.activeElement.selectionStart
    : null;
  let title = "BrawlQuest Armoury";
  let html = "";
  if (!section) {
    html = viewHome(route);
  } else if (section === "items") {
    title = "Items · BrawlQuest Armoury";
    html = viewItems(route);
  } else if (section === "item") {
    html = viewItem(route);
    title = (byId.items.get(Number(route.parts[1]))?.name || "Item") + " · BrawlQuest Armoury";
  } else if (section === "mobs") {
    title = "Mobs · BrawlQuest Armoury";
    html = viewMobs(route);
  } else if (section === "mob") {
    html = viewMob(route);
    title = (byId.mobs.get(Number(route.parts[1]))?.name || "Mob") + " · BrawlQuest Armoury";
  } else if (section === "sets") {
    title = "Sets · BrawlQuest Armoury";
    html = viewSets(route);
  } else if (section === "set") {
    html = viewSet(route);
    title = (byId.sets.get(route.parts[1])?.name || "Set") + " · BrawlQuest Armoury";
  } else if (section === "characters") {
    title = "Characters · BrawlQuest Armoury";
    html = viewCharacters(route);
  } else if (section === "character") {
    html = viewCharacter(route);
    title = (byId.characters.get(Number(route.parts[1]))?.name || "Character") + " · BrawlQuest Armoury";
  } else {
    html = `<h1>Not found</h1><p>That page is not in the armoury. <a href="#/">Go home</a>.</p>`;
  }
  document.title = title;
  main().innerHTML = html;
  if (scroll && keepFocus === null) window.scrollTo(0, 0);
  const box = document.getElementById("q");
  if (box && keepFocus !== null) {
    box.focus();
    const pos = Math.min(keepFocus, box.value.length);
    box.setSelectionRange(pos, pos);
  }
}

function notesBlock() {
  return `<p class="note">${esc(DB.meta.dropNote)}</p><p class="note">${esc(DB.meta.varianceNote)}</p>`;
}

function viewHome(route) {
  const q = route.params.get("q") || "";
  const counts = DB.meta.counts;
  let results = "";
  if (q.trim()) {
    results = homeResults(q.trim());
  }
  return `
    <h1>BrawlQuest Armoury</h1>
    <p class="lede">Look up gear, who drops it, mobs, named sets, and every character.</p>
    <label for="q">Search items, mobs, sets, and characters</label>
    <input id="q" class="search" type="search" enterkeyhint="search" autocomplete="off" placeholder="Try a name, a mob, or a weapon" value="${esc(q)}">
    ${results}
    <div class="home-links">
      <a href="#/items"><b>${num(counts.items)}</b> Items</a>
      <a href="#/mobs"><b>${num(counts.mobs)}</b> Mobs</a>
      <a href="#/sets"><b>${num(counts.sets)}</b> Sets</a>
      <a href="#/characters"><b>${num(counts.characters)}</b> Characters</a>
    </div>`;
}

function takeMatches(list, q, limit) {
  const query = q.trim();
  const found = [];
  for (const entry of list) {
    const score = rank(entry.name, query);
    if (score < 9) found.push([score, entry.name, entry]);
  }
  found.sort((a, b) => a[0] - b[0] || lower(a[1]).localeCompare(lower(b[1]), "en-GB") || (a[2].id > b[2].id ? 1 : -1));
  return found.slice(0, limit).map((row) => row[2]);
}

function homeResults(q) {
  const items = takeMatches(DB.items, q, 12);
  const mobs = takeMatches(DB.mobs, q, 8);
  const sets = takeMatches(DB.sets, q, 8);
  const chars = takeMatches(DB.characters, q, 12);
  if (!items.length && !mobs.length && !sets.length && !chars.length) {
    return `<p>Nothing matches “${esc(q)}”.</p>`;
  }
  const block = (title, rows, inner) => rows.length
    ? `<section class="group"><h2>${title}</h2><div class="rows">${rows.map(inner).join("")}</div></section>`
    : "";
  return (
    block("Items", items, (it) => rowLink(`#/item/${it.id}`, it.name, typeLabel(it.type))) +
    block("Mobs", mobs, (m) => rowLink(`#/mob/${m.id}`, m.name, `${num(m.hp)} HP · ${num(m.atk)} ATK`)) +
    block("Sets", sets, (s) => rowLink(`#/set/${encodeURIComponent(s.id)}`, s.name, `${s.itemIds.length} pieces`)) +
    block("Characters", chars, (c) => rowLink(`#/character/${c.id}`, c.name, charMeta(c)))
  );
}

function rowLink(hash, name, meta) {
  return `<a class="row" href="${hash}"><span>${esc(name)}</span><span class="meta">${esc(meta)}</span></a>`;
}

function charMeta(c) {
  const bits = [`Level ${num(c.level)}`, c.class, `Prestige ${num(c.prestige)}`];
  if (c.hardcore) bits.push("Hardcore");
  return bits.join(" · ");
}

function viewItems(route) {
  const q = route.params.get("q") || "";
  const type = route.params.get("type") || "";
  const types = [...new Set(DB.items.map((it) => it.type))].sort((a, b) => typeLabel(a).localeCompare(typeLabel(b), "en-GB"));
  const chips = [`<a class="chip" href="${href(itemQuery("", q))}" ${type ? "" : 'aria-current="true"'}>All</a>`]
    .concat(types.map((t) => `<a class="chip" href="${href(itemQuery(t, q))}" ${t === type ? 'aria-current="true"' : ""}>${esc(typeLabel(t))}</a>`))
    .join("");
  let list = DB.items.slice();
  if (type) list = list.filter((it) => it.type === type);
  if (q.trim()) {
    list = list.filter((it) => rank(it.name, q) < 9 || lower(it.desc).includes(lower(q)));
    list.sort((a, b) => rank(a.name, q) - rank(b.name, q) || a.name.localeCompare(b.name, "en-GB"));
  } else {
    list.sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
  }
  return `
    <h1>Items</h1>
    <label for="q">Search items</label>
    <input id="q" class="search" type="search" enterkeyhint="search" autocomplete="off" placeholder="Item name" value="${esc(q)}">
    <div class="chips">${chips}</div>
    <p class="count">${num(list.length)} shown</p>
    <div class="cards">${list.map(itemCard).join("") || "<p>No items match.</p>"}</div>`;
}

function itemQuery(type, q) {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (q) params.set("q", q);
  const tail = params.toString();
  return "/items" + (tail ? "?" + tail : "");
}

function itemCard(it) {
  const set = it.setId ? byId.sets.get(it.setId) : null;
  return `<a class="card" href="#/item/${it.id}">${icon(it)}<strong>${esc(it.name)}</strong><span class="sub">${esc(typeLabel(it.type))}${set ? " · " + esc(set.name) : ""}</span></a>`;
}

function viewItem(route) {
  const item = byId.items.get(Number(route.parts[1]));
  if (!item) return `<h1>Item not found</h1><p><a href="#/items">Back to items</a></p>`;
  const set = item.setId ? byId.sets.get(item.setId) : null;
  const drops = item.drops.map((drop) => {
    const mob = byId.mobs.get(drop.enemyId);
    const who = mob
      ? `<a href="#/mob/${mob.id}">${esc(mob.name)}</a>`
      : `No mob in the catalogue has id ${num(drop.enemyId)}`;
    return `<div class="drop">${mob ? icon(mob) : icon("", true)}<div>${who}<div class="sub">${num(drop.chance)}% · amount ${num(drop.amount)} · variance ${num(drop.variance)}</div></div></div>`;
  }).join("");
  return `
    <p><a href="#/items">Items</a></p>
    <div class="hero">${icon(item, false, true)}
      <div class="hero-text">
        <h1>${esc(item.name)}</h1>
        <p>${esc(item.desc || "No description.")}</p>
      </div>
    </div>
    <div class="kvs">
      ${stat("Type", typeLabel(item.type))}
      ${stat("Subtype", item.subtype || "—")}
      ${stat("Worth", num(item.worth))}
      ${stat("Cooldown", num(item.cooldown))}
      ${stat("Val", num(item.val))}
      ${stat("Attributes", attrText(item.attributes))}
    </div>
    <p>${set ? `Part of the <a href="#/set/${encodeURIComponent(set.id)}">${esc(set.name)}</a> set.` : "Not part of a named set."}</p>
    ${item.note ? `<p class="note">${esc(item.note)}</p>` : ""}
    <h2>Dropped by</h2>
    ${notesBlock()}
    ${drops || "<p>No loot rows for this item.</p>"}`;
}

function stat(label, value) {
  return `<div class="stat"><b>${esc(String(value))}</b><span>${esc(label)}</span></div>`;
}

function viewMobs(route) {
  const q = route.params.get("q") || "";
  let list = DB.mobs.slice();
  if (q.trim()) list = list.filter((m) => rank(m.name, q) < 9);
  list.sort((a, b) => rank(a.name, q) - rank(b.name, q) || a.name.localeCompare(b.name, "en-GB"));
  return `
    <h1>Mobs</h1>
    <label for="q">Search mobs</label>
    <input id="q" class="search" type="search" enterkeyhint="search" autocomplete="off" placeholder="Mob name" value="${esc(q)}">
    <p class="count">${num(list.length)} shown</p>
    <div class="cards">${list.map((m) => `<a class="card" href="#/mob/${m.id}">${icon(m)}<strong>${esc(m.name)}</strong><span class="sub">${num(m.hp)} HP · ${num(m.atk)} ATK</span></a>`).join("") || "<p>No mobs match.</p>"}</div>`;
}

function viewMob(route) {
  const mob = byId.mobs.get(Number(route.parts[1]));
  if (!mob) return `<h1>Mob not found</h1><p><a href="#/mobs">Back to mobs</a></p>`;
  const spells = mob.spells.length
    ? mob.spells.map((s) => `<div class="drop"><div></div><div><strong>${esc(s.name)}</strong><div class="sub">Value ${esc(s.value || "—")} · frequency ${num(s.frequency)}</div></div></div>`).join("")
    : "<p>No spells recorded.</p>";
  const drops = mob.drops.map((drop) => {
    const item = byId.items.get(drop.itemId);
    const who = item ? `<a href="#/item/${item.id}">${esc(item.name)}</a>` : `Item ${num(drop.itemId)} is not in the catalogue`;
    return `<div class="drop">${item ? icon(item) : icon("", true)}<div>${who}<div class="sub">${num(drop.chance)}% · amount ${num(drop.amount)} · variance ${num(drop.variance)}</div></div></div>`;
  }).join("");
  return `
    <p><a href="#/mobs">Mobs</a></p>
    <div class="hero">${icon(mob, false, true)}
      <div class="hero-text"><h1>${esc(mob.name)}</h1></div>
    </div>
    <div class="kvs">
      ${stat("HP", num(mob.hp))}
      ${stat("ATK", num(mob.atk))}
      ${stat("XP", num(mob.xp))}
      ${stat("Range", num(mob.range))}
      ${stat("Can move", mob.canMove ? "Yes" : "No")}
      ${stat("Attributes", attrText(mob.attributes))}
    </div>
    ${mob.note ? `<p class="note">${esc(mob.note)}</p>` : ""}
    <h2>Spells</h2>
    ${spells}
    <h2>Drops</h2>
    ${notesBlock()}
    ${drops || "<p>No loot rows for this mob.</p>"}`;
}

function viewSets(route) {
  const q = route.params.get("q") || "";
  let list = DB.sets.slice();
  if (q.trim()) list = list.filter((s) => rank(s.name, q) < 9);
  list.sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
  return `
    <h1>Sets</h1>
    <p class="lede">Sets are not a catalogue table. Pieces are grouped when gear shares a clear name stem, and a set needs at least two pieces.</p>
    <label for="q">Search sets</label>
    <input id="q" class="search" type="search" enterkeyhint="search" autocomplete="off" placeholder="Set name" value="${esc(q)}">
    <p class="count">${num(list.length)} shown</p>
    <div class="cards">${list.map((s) => {
      const first = byId.items.get(s.itemIds[0]);
      return `<a class="card" href="#/set/${encodeURIComponent(s.id)}">${first ? icon(first) : icon("", true)}<strong>${esc(s.name)}</strong><span class="sub">${s.itemIds.length} pieces</span></a>`;
    }).join("") || "<p>No sets match.</p>"}</div>`;
}

function viewSet(route) {
  const set = byId.sets.get(decodeURIComponent(route.parts[1] || ""));
  if (!set) return `<h1>Set not found</h1><p><a href="#/sets">Back to sets</a></p>`;
  const cards = set.itemIds.map((id) => byId.items.get(id)).filter(Boolean).map(itemCard).join("");
  return `
    <p><a href="#/sets">Sets</a></p>
    <h1>${esc(set.name)}</h1>
    <p class="count">${set.itemIds.length} pieces</p>
    <div class="cards">${cards}</div>`;
}

function viewCharacters(route) {
  const q = route.params.get("q") || "";
  const sort = route.params.get("sort") === "prestige" ? "prestige" : "level";
  let list = DB.characters.slice();
  if (q.trim()) list = list.filter((c) => rank(c.name, q) < 9);
  list.sort((a, b) => {
    const score = q.trim() ? rank(a.name, q) - rank(b.name, q) : 0;
    if (score) return score;
    if (sort === "prestige") {
      if (b.prestige !== a.prestige) return b.prestige - a.prestige;
    }
    if (b.level !== a.level) return b.level - a.level;
    if (b.xp !== a.xp) return b.xp - a.xp;
    return a.name.localeCompare(b.name, "en-GB") || a.id - b.id;
  });
  const shown = list.slice(0, charShown);
  const more = list.length > shown.length
    ? `<button class="more" type="button" id="more">Show more (${num(list.length - shown.length)} left)</button>`
    : "";
  return `
    <h1>Characters</h1>
    <p class="lede">Every character is here. Search your name. Exact spelling is kept, so “Pebsie” and “pebsie” are different characters. Level, class, and prestige separate people who share a name.</p>
    <label for="q">Search by character name</label>
    <input id="q" class="search" type="search" enterkeyhint="search" autocomplete="off" placeholder="Your character name" value="${esc(q)}">
    <div class="sorts">
      <button type="button" data-sort="level" aria-pressed="${sort === "level"}">Sort by level</button>
      <button type="button" data-sort="prestige" aria-pressed="${sort === "prestige"}">Sort by prestige</button>
    </div>
    <p class="count">${num(list.length)} match${list.length === 1 ? "" : "es"} · showing ${num(shown.length)}</p>
    <div class="rows">${shown.map((c) => rowLink(`#/character/${c.id}`, c.name, charMeta(c))).join("") || "<p>No character has that name.</p>"}</div>
    ${more}`;
}

function gearSlot(label, itemId) {
  if (!itemId) {
    return `<div class="slot empty"><span class="ph" role="img" aria-label="Empty">Empty</span><strong>${esc(label)}</strong><span class="sub">Empty</span></div>`;
  }
  const item = byId.items.get(itemId);
  if (!item) {
    return `<div class="slot empty"><span class="ph">No image</span><strong>${esc(label)}</strong><span class="sub">Item ${num(itemId)} is not in the catalogue</span></div>`;
  }
  return `<a class="slot" href="#/item/${item.id}">${icon(item)}<strong>${esc(label)}</strong><span class="sub">${esc(item.name)}</span></a>`;
}

function viewCharacter(route) {
  const ch = byId.characters.get(Number(route.parts[1]));
  if (!ch) return `<h1>Character not found</h1><p><a href="#/characters">Back to characters</a></p>`;
  const slots = SLOT_ORDER.map(([key, label]) => gearSlot(label, ch[key])).join("");
  let buddy = "";
  if (!ch.buddyIds.length) {
    buddy = gearSlot("Buddy", 0);
  } else if (ch.buddyIds.length === 1) {
    buddy = gearSlot("Buddy", ch.buddyIds[0]);
  } else {
    const links = ch.buddyIds.map((id) => {
      const item = byId.items.get(id);
      return item ? `<a href="#/item/${item.id}">${esc(item.name)}</a>` : `Item ${num(id)}`;
    }).join(", ");
    const first = byId.items.get(ch.buddyIds[0]);
    buddy = `<div class="slot">${first ? icon(first) : icon("", true)}<strong>Buddy</strong><span class="sub">${links}. These catalogue rows share one image, so the character record does not say which row it is.</span></div>`;
  }
  return `
    <p><a href="#/characters">Characters</a></p>
    <h1>${esc(ch.name)}${ch.hardcore ? '<span class="badge">Hardcore</span>' : ""}</h1>
    <div class="kvs">
      ${stat("Level", num(ch.level))}
      ${stat("XP", num(ch.xp))}
      ${stat("Class", ch.class === "None" ? "None" : ch.class)}
      ${stat("STR", num(ch.str))}
      ${stat("INT", num(ch.int))}
      ${stat("STA", num(ch.sta))}
      ${stat("Prestige", num(ch.prestige))}
      ${stat("Hardcore", ch.hardcore ? "Yes" : "No")}
    </div>
    <h2>Equipped</h2>
    <div class="gear">${slots}${buddy}</div>`;
}

document.body.addEventListener("input", (event) => {
  if (event.target.id !== "q") return;
  const box = event.target;
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    const route = parseRoute();
    const section = route.parts[0] || "";
    const params = new URLSearchParams(route.params);
    const value = box.value;
    if (value) params.set("q", value);
    else params.delete("q");
    charShown = 80;
    const base = section ? "/" + section : "/";
    const tail = params.toString();
    replaceHash(base + (tail ? "?" + tail : ""));
    render(false);
  }, 120);
});

document.body.addEventListener("click", (event) => {
  const sortBtn = event.target.closest("[data-sort]");
  if (sortBtn) {
    const route = parseRoute();
    const params = new URLSearchParams(route.params);
    params.set("sort", sortBtn.getAttribute("data-sort"));
    charShown = 80;
    const tail = params.toString();
    location.hash = "/characters" + (tail ? "?" + tail : "");
    return;
  }
  if (event.target.id === "more") {
    charShown += 80;
    render(false);
  }
});

document.body.addEventListener("submit", (event) => event.preventDefault());

boot();
