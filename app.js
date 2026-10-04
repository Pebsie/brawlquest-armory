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
let routeStamp = "";
const byId = { items: new Map(), mobs: new Map(), sets: new Map(), characters: new Map(), quests: new Map(), npcs: new Map() };
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
  const obj = typeof itemOrPath === "string" ? null : itemOrPath;
  const path = typeof itemOrPath === "string" ? itemOrPath : obj && obj.img;
  const gone = typeof itemOrPath === "string" ? missing : (missing || (obj && obj.imgMissing) || !path);
  const cls = large ? "lg" : "";
  if (gone || !path) {
    return `<span class="ph ${cls}" role="img" aria-label="No image">No image</span>`;
  }
  const scale = large ? 4 : 2;
  const w = obj && obj.w ? obj.w * scale : 0;
  const h = obj && obj.h ? obj.h * scale : 0;
  const dim = w && h ? ` width="${w}" height="${h}" style="width:${w}px;height:${h}px"` : "";
  return `<img class="icon ${cls}" alt=""${dim} src="${esc(imgUrl(path))}">`;
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

function dropText(drop) {
  const amount = Number(drop.amount) || 0;
  const variance = Number(drop.variance) || 0;
  let amountText = "amount " + amount;
  if (variance) {
    const min = Math.max(0, amount - variance);
    const max = amount + variance;
    amountText = min === max ? "amount " + min : "amount " + min + "-" + max;
  }
  return drop.chance + "% drop rate · " + amountText;
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
  for (const quest of DB.quests || []) {
    quest.name = quest.title;
    byId.quests.set(quest.id, quest);
  }
  for (const npc of DB.npcs || []) byId.npcs.set(npc.id, npc);
  window.addEventListener("hashchange", () => render(true));
  render(true);
}

function render(scroll) {
  const route = parseRoute();
  const section = route.parts[0] || "";
  const navSection = { item: "items", mob: "mobs", set: "sets", character: "characters", quest: "quests", npc: "npcs", map: "map" }[section] || section;
  setNav(navSection);
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
  } else if (section === "recipes") {
    title = "Recipes · BrawlQuest Armoury";
    html = viewRecipes(route);
  } else if (section === "set") {
    html = viewSet(route);
    title = (byId.sets.get(route.parts[1])?.name || "Set") + " · BrawlQuest Armoury";
  } else if (section === "quests") {
    title = "Quests · BrawlQuest Armoury";
    html = viewQuests(route);
  } else if (section === "quest") {
    html = viewQuest(route);
    title = (byId.quests.get(Number(route.parts[1]))?.title || "Quest") + " · BrawlQuest Armoury";
  } else if (section === "npcs") {
    title = "NPCs · BrawlQuest Armoury";
    html = viewNpcs(route);
  } else if (section === "npc") {
    html = viewNpc(route);
    title = (byId.npcs.get(Number(route.parts[1]))?.name || "NPC") + " · BrawlQuest Armoury";
  } else if (section === "characters") {
    title = "Characters · BrawlQuest Armoury";
    html = viewCharacters(route);
  } else if (section === "character") {
    html = viewCharacter(route);
    title = (byId.characters.get(Number(route.parts[1]))?.name || "Character") + " · BrawlQuest Armoury";
  } else if (section === "map") {
    title = "Map · BrawlQuest Armoury";
    html = viewMap();
  } else {
    html = `<h1>Not found</h1><p>That page is not in the armoury. <a href="#/">Go home</a>.</p>`;
  }
  document.title = title;
  const talkKey = section === "npc" && route.parts[1] ? "npc:" + route.parts[1] : "";
  const sameTalk = talkKey !== "" && talkKey === routeStamp;
  main().innerHTML = html;
  if (scroll && keepFocus === null && !sameTalk) window.scrollTo(0, 0);
  routeStamp = talkKey || (section + ":" + (route.parts[1] || ""));
  if (section === "map") initMap();
  const box = document.getElementById("q");
  if (box && keepFocus !== null) {
    box.focus();
    const pos = Math.min(keepFocus, box.value.length);
    box.setSelectionRange(pos, pos);
  }
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
    <p class="lede">Gear, mobs, quests, NPCs, characters, and the world map.</p>
    <label for="q">Search</label>
    <input id="q" class="search" type="search" enterkeyhint="search" autocomplete="off" placeholder="Try a name, a mob, or a weapon" value="${esc(q)}">
    ${results}
    <div class="home-links">
      <a href="#/items"><b>${num(counts.items)}</b> Items</a>
      <a href="#/mobs"><b>${num(counts.mobs)}</b> Mobs</a>
      <a href="#/sets"><b>${num(counts.sets)}</b> Sets</a>
      <a href="#/recipes"><b>${num(counts.recipes)}</b> Recipes</a>
      <a href="#/quests"><b>${num(counts.quests)}</b> Quests</a>
      <a href="#/npcs"><b>${num(counts.npcs)}</b> NPCs</a>
      <a href="#/characters"><b>${num(counts.characters)}</b> Characters</a>
      <a href="#/map"><b>${num(counts.tiles)}</b> Map tiles</a>
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
  const quests = takeMatches(DB.quests, q, 8);
  const npcs = takeMatches(DB.npcs, q, 8);
  if (!items.length && !mobs.length && !sets.length && !chars.length && !quests.length && !npcs.length) {
    return `<p>Nothing matches “${esc(q)}”.</p>`;
  }
  const block = (title, rows, inner) => rows.length
    ? `<section class="group"><h2>${title}</h2><div class="rows">${rows.map(inner).join("")}</div></section>`
    : "";
  return (
    block("Items", items, (it) => rowLink(`#/item/${it.id}`, it.name, typeLabel(it.type))) +
    block("Mobs", mobs, (m) => rowLink(`#/mob/${m.id}`, m.name, `${num(m.hp)} HP · ${num(m.atk)} ATK`)) +
    block("Sets", sets, (s) => rowLink(`#/set/${encodeURIComponent(s.id)}`, s.name, `${s.itemIds.length} pieces`)) +
    block("Quests", quests, (quest) => rowLink(`#/quest/${quest.id}`, quest.title, objectiveText(quest))) +
    block("NPCs", npcs, (npc) => rowLink(`#/npc/${npc.id}`, npc.name, npc.faction || "No faction")) +
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
    return `<div class="drop">${mob ? icon(mob) : icon("", true)}<div>${who}<div class="sub">${esc(dropText(drop))}</div></div></div>`;
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
    ${recipeBlock(item)}
    <h2>Dropped by</h2>
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
    ? mob.spells.map((s) => `<p>${spellLine(s)}</p>`).join("")
    : "<p>No spells recorded.</p>";
  const drops = mob.drops.map((drop) => {
    const item = byId.items.get(drop.itemId);
    const who = item ? `<a href="#/item/${item.id}">${esc(item.name)}</a>` : `Item ${num(drop.itemId)} is not in the catalogue`;
    return `<div class="drop">${item ? icon(item) : icon("", true)}<div>${who}<div class="sub">${esc(dropText(drop))}</div></div></div>`;
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
    <h2>Spells</h2>
    ${spells}
    <h2>Drops</h2>
    ${drops || "<p>No loot rows for this mob.</p>"}`;
}

function viewSets(route) {
  const q = route.params.get("q") || "";
  let list = DB.sets.slice();
  if (q.trim()) list = list.filter((s) => rank(s.name, q) < 9);
  list.sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
  return `
    <h1>Sets</h1>
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
    ${dollHtml(ch)}
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
    <div class="gear">${slots}${buddy}</div>
    ${ownedBlock("Mounts", ch.mounts)}
    ${ownedBlock("Buddies", ch.buddies)}`;
}


function spellMob(spell) {
  if (!spell.mobId) return null;
  return byId.mobs.get(spell.mobId) || null;
}

function spellTarget(spell) {
  const mob = spellMob(spell);
  if (mob) return `<a href="#/mob/${mob.id}">${esc(mob.name)}</a>`;
  return esc(spell.value || "");
}

function spellLine(spell) {
  const every = `every ${num(spell.frequency)} seconds`;
  if (spell.name === "Spawn") return `Spawns ${spellTarget(spell)} ${every}`;
  if (spell.name === "Spawn Nearby") return `Spawns ${spellTarget(spell)} ${every} nearby`;
  if (spell.name === "Spawn At Target") return `Spawns ${spellTarget(spell)} on its target ${every}`;
  if (spell.name === "Death") return `Destroys itself ${every}`;
  if (spell.name === "Poison") return `Poisons its target ${every}`;
  const bits = [esc(spell.name)];
  if (spell.value) bits.push(spellTarget(spell));
  if (spell.frequency !== null && spell.frequency !== undefined && spell.frequency !== "") {
    bits.push("frequency " + num(spell.frequency));
  }
  return bits.join(" · ");
}

function recipesForResult(itemId) {
  return (DB.recipes || []).filter((recipe) => recipe.resultId === itemId);
}

function recipesUsing(itemId) {
  return (DB.recipes || []).filter((recipe) => recipe.ingredients.some((part) => part.itemId === itemId));
}

function ingredientHtml(part) {
  const item = byId.items.get(part.itemId);
  const name = item ? `<a href="#/item/${item.id}">${esc(item.name)}</a>` : `Item ${num(part.itemId)}`;
  const qty = part.amount === null || part.amount === undefined ? "" : `${num(part.amount)} × `;
  return `<span class="ing">${item ? icon(item) : icon("", true)}<span>${qty}${name}</span></span>`;
}

function recipeCard(recipe) {
  const result = byId.items.get(recipe.resultId);
  const resultName = result ? `<a href="#/item/${result.id}">${esc(result.name)}</a>` : `Item ${num(recipe.resultId)}`;
  const chance = recipe.kind === "forge" ? "Forge" : `${num(recipe.chance)}% chance`;
  return `<div class="recipe">${result ? icon(result) : icon("", true)}<div><div>${resultName}</div><div class="sub">${chance}</div><div class="ings">${recipe.ingredients.map(ingredientHtml).join("")}</div></div></div>`;
}

function recipeBlock(item) {
  const made = recipesForResult(item.id);
  const used = recipesUsing(item.id);
  let html = "";
  if (made.length) {
    html += `<h2>${made.length > 1 ? "Recipes" : "Recipe"}</h2>` + made.map(recipeCard).join("");
  }
  if (used.length) {
    const links = used.map((recipe) => {
      const result = byId.items.get(recipe.resultId);
      const label = result ? esc(result.name) : "Item " + num(recipe.resultId);
      const href = result ? `#/item/${result.id}` : "#/recipes";
      const via = recipe.kind === "forge" ? "forge" : "craft";
      return `<a href="${href}">${label}</a> (${via})`;
    }).join(", ");
    html += `<h2>Used in</h2><p>${links}</p>`;
  }
  return html;
}

function viewRecipes(route) {
  const q = route.params.get("q") || "";
  let list = (DB.recipes || []).slice();
  if (q.trim()) {
    list = list.filter((recipe) => {
      const result = byId.items.get(recipe.resultId);
      if (result && rank(result.name, q) < 9) return true;
      return recipe.ingredients.some((part) => {
        const item = byId.items.get(part.itemId);
        return item && rank(item.name, q) < 9;
      });
    });
  }
  return `
    <h1>Recipes</h1>
    <label for="q">Search recipes</label>
    <input id="q" class="search" type="search" enterkeyhint="search" autocomplete="off" placeholder="Result or ingredient" value="${esc(q)}">
    <p class="count">${num(list.length)} shown</p>
    ${list.map(recipeCard).join("") || "<p>No recipes match.</p>"}`;
}

function dollLayers(ch) {
  const layers = [];
  const mountEntry = (ch.mounts || [])[0];
  const mount = mountEntry ? byId.items.get(mountEntry.itemId) : null;
  const boat = !!(mount && mount.boat);
  if (mount && mount.mountBack && mount.mountBackW) {
    layers.push({
      src: mount.mountBack,
      x: boat ? 0 : 6,
      y: boat ? 0 : 9,
      w: mount.mountBackW,
      h: mount.mountBackH,
      z: 1,
    });
  }
  if (!boat && ch.shieldId && DB.meta.doll && DB.meta.doll.shieldW) {
    layers.push({
      src: DB.meta.doll.shieldBack,
      x: 0,
      y: 0,
      w: DB.meta.doll.shieldW,
      h: DB.meta.doll.shieldH,
      z: 2,
    });
  }
  const weapon = byId.items.get(ch.weaponId);
  if (!boat && weapon && weapon.img && !weapon.imgMissing && weapon.w) {
    layers.push({
      src: weapon.img,
      x: -(weapon.w - 32),
      y: -(weapon.h - 32),
      w: weapon.w,
      h: weapon.h,
      z: 3,
    });
  }
  if (!boat && DB.meta.doll && DB.meta.doll.bodyW) {
    layers.push({
      src: DB.meta.doll.body,
      x: 0,
      y: 0,
      w: DB.meta.doll.bodyW,
      h: DB.meta.doll.bodyH,
      z: 4,
    });
    for (const [key, z] of [["legsId", 5], ["chestId", 6], ["headId", 7]]) {
      const piece = byId.items.get(ch[key]);
      if (!piece || !piece.img || piece.imgMissing || !piece.w) continue;
      let x = 0;
      let y = 0;
      if (piece.w > 32) x -= piece.w - 32;
      if (piece.h > 32) y -= piece.h - 32;
      layers.push({ src: piece.img, x, y, w: piece.w, h: piece.h, z });
    }
  }
  if (!boat && mount && mount.mountFore && mount.mountForeW) {
    layers.push({
      src: mount.mountFore,
      x: 6,
      y: 9,
      w: mount.mountForeW,
      h: mount.mountForeH,
      z: 8,
    });
  }
  return layers;
}

function dollHtml(ch) {
  const layers = dollLayers(ch);
  if (!layers.length) return "";
  let minX = 0;
  let minY = 0;
  let maxX = 32;
  let maxY = 32;
  for (const layer of layers) {
    minX = Math.min(minX, layer.x);
    minY = Math.min(minY, layer.y);
    maxX = Math.max(maxX, layer.x + layer.w);
    maxY = Math.max(maxY, layer.y + layer.h);
  }
  const scale = 4;
  const width = (maxX - minX) * scale;
  const height = (maxY - minY) * scale;
  const imgs = layers.map((layer) => {
    const left = (layer.x - minX) * scale;
    const top = (layer.y - minY) * scale;
    return `<img alt="" style="left:${left}px;top:${top}px;width:${layer.w * scale}px;height:${layer.h * scale}px;z-index:${layer.z}" src="${esc(imgUrl(layer.src))}">`;
  }).join("");
  return `<div class="doll" style="width:${width}px;height:${height}px">${imgs}</div>`;
}

function ownedBlock(title, rows) {
  if (!rows || !rows.length) return "";
  const cards = rows.map((row) => {
    const item = byId.items.get(row.itemId);
    if (!item) return "";
    const extra = row.amount > 1 ? ` × ${num(row.amount)}` : "";
    return `<a class="card" href="#/item/${item.id}">${icon(item)}<strong>${esc(item.name)}${extra}</strong><span class="sub">${esc(typeLabel(item.type))}</span></a>`;
  }).join("");
  return `<h2>${esc(title)}</h2><div class="cards">${cards}</div>`;
}


function objectiveText(quest) {
  const n = num(quest.required);
  if (quest.type === "kill") return `Kill ${n} ${quest.value}`;
  if (quest.type === "gather") return `Gather ${n} ${quest.value}`;
  if (quest.type === "go") return `Go to ${quest.x}, ${quest.y}`;
  return `${quest.type || "Objective"}: ${quest.value} (${n})`;
}

function npcLink(id, fallback) {
  const npc = byId.npcs.get(id);
  if (!npc) return esc(fallback || "Unknown NPC");
  return `<a href="#/npc/${npc.id}">${esc(npc.name)}</a>`;
}

function grantText(part) {
  const item = byId.items.get(part.itemId);
  const name = item ? `<a href="#/item/${item.id}">${esc(item.name)}</a>` : `Item ${num(part.itemId)}`;
  const amount = Number(part.amount) || 0;
  if (amount < 0) return `Takes ${num(Math.abs(amount))} ${name}`;
  return `Gives ${num(amount)} ${name}`;
}

function viewQuests(route) {
  const q = route.params.get("q") || "";
  let list = (DB.quests || []).slice();
  if (q.trim()) list = list.filter((quest) => rank(quest.title, q) < 9 || lower(quest.desc).includes(lower(q)));
  list.sort((a, b) => rank(a.title, q) - rank(b.title, q) || a.title.localeCompare(b.title, "en-GB"));
  return `
    <h1>Quests</h1>
    <label for="q">Search quests</label>
    <input id="q" class="search" type="search" enterkeyhint="search" autocomplete="off" placeholder="Quest name" value="${esc(q)}">
    <p class="count">${num(list.length)} shown</p>
    <div class="rows">${list.map((quest) => rowLink(`#/quest/${quest.id}`, quest.title, objectiveText(quest))).join("") || "<p>No quests match.</p>"}</div>`;
}

function viewQuest(route) {
  const quest = byId.quests.get(Number(route.parts[1]));
  if (!quest) return `<h1>Quest not found</h1><p><a href="#/quests">Back to quests</a></p>`;
  const rewards = (quest.items || []).map((part) => `<p>${grantText(part)}</p>`).join("");
  const trigger = quest.trigger
    ? `<a href="#/npc/${quest.giverNpcId}/${encodeURIComponent(quest.trigger)}">${esc(quest.trigger)}</a>`
    : "—";
  const end = quest.endConversation
    ? `<a href="#/npc/${quest.returnNpcId}/${encodeURIComponent(quest.endConversation)}">${esc(quest.endConversation)}</a>`
    : "—";
  return `
    <p><a href="#/quests">Quests</a></p>
    <div class="hero">${icon(quest, false, true)}
      <div class="hero-text"><h1>${esc(quest.title)}</h1><p>${esc(quest.desc || "")}</p></div>
    </div>
    <div class="kvs">
      ${stat("XP", num(quest.xp))}
      ${stat("Objective", objectiveText(quest))}
    </div>
    <p>Giver: ${npcLink(quest.giverNpcId)}</p>
    <p>Return to: ${npcLink(quest.returnNpcId, quest.returnNpcName)}${quest.returnNpcName && byId.npcs.get(quest.returnNpcId) && byId.npcs.get(quest.returnNpcId).name !== quest.returnNpcName ? " (" + esc(quest.returnNpcName) + ")" : ""}</p>
    <p>${quest.requireReturn ? "Must be handed back." : "Completes without a return."}</p>
    <p>Starts at ${trigger}. Ends at ${end}.</p>
    ${rewards ? `<h2>Rewards</h2>${rewards}` : ""}`;
}

function viewNpcs(route) {
  const q = route.params.get("q") || "";
  let list = (DB.npcs || []).slice();
  if (q.trim()) list = list.filter((npc) => rank(npc.name, q) < 9 || lower(npc.faction).includes(lower(q)));
  list.sort((a, b) => rank(a.name, q) - rank(b.name, q) || a.name.localeCompare(b.name, "en-GB") || a.id - b.id);
  return `
    <h1>NPCs</h1>
    <label for="q">Search NPCs</label>
    <input id="q" class="search" type="search" enterkeyhint="search" autocomplete="off" placeholder="NPC name" value="${esc(q)}">
    <p class="count">${num(list.length)} shown</p>
    <div class="cards">${list.map((npc) => `<a class="card" href="#/npc/${npc.id}">${icon(npc)}<strong>${esc(npc.name)}</strong><span class="sub">${esc(npc.faction || "No faction")}</span></a>`).join("") || "<p>No NPCs match.</p>"}</div>`;
}

function viewNpc(route) {
  const npc = byId.npcs.get(Number(route.parts[1]));
  if (!npc) return `<h1>NPC not found</h1><p><a href="#/npcs">Back to NPCs</a></p>`;
  const nodeId = route.parts[2] ? decodeURIComponent(route.parts[2]) : "";
  const questLine = (ids, label) => {
    if (!ids || !ids.length) return "";
    const links = ids.map((id) => {
      const quest = byId.quests.get(id);
      return quest ? `<a href="#/quest/${quest.id}">${esc(quest.title)}</a>` : `Quest ${num(id)}`;
    }).join(", ");
    return `<p>${label}: ${links}</p>`;
  };
  return `
    <p><a href="#/npcs">NPCs</a></p>
    <div class="hero">${icon(npc, false, true)}
      <div class="hero-text">
        <h1>${esc(npc.name)}</h1>
        <p>${esc(npc.faction || "No faction")}</p>
        <p class="sub">Spawn ${num(npc.spawnX)}, ${num(npc.spawnY)}</p>
      </div>
    </div>
    ${questLine(npc.gives, "Gives")}
    ${questLine(npc.returns, "Return here")}
    <h2>Dialogue</h2>
    ${dialogueHtml(npc, nodeId)}`;
}

function dialogueHtml(npc, nodeId) {
  if (!npc.conversation) return "<p>No dialogue.</p>";
  const start = DB.dialogue[npc.conversation];
  if (!start && !nodeId) return `<p>No line for ${esc(npc.conversation)}.</p>`;
  if (nodeId === "end") {
    return `<div class="talk"><p>The conversation ends.</p><p><a class="choice" href="#/npc/${npc.id}">Start over</a></p></div>`;
  }
  const key = nodeId || npc.conversation;
  const node = DB.dialogue[key];
  if (!node) return `<p>That line is not in the catalogue. <a href="#/npc/${npc.id}">Start over</a></p>`;
  const portrait = (!node.imgMissing && node.img) ? node : npc;
  const effects = [];
  for (const part of node.items || []) effects.push(`<p>${grantText(part)}</p>`);
  if (node.reputation) effects.push(`<p>Reputation ${node.reputation > 0 ? "+" : ""}${node.reputation}</p>`);
  for (const id of node.questIds || []) {
    const quest = byId.quests.get(id);
    effects.push(`<p>Starts <a href="#/quest/${id}">${esc(quest ? quest.title : "quest " + id)}</a></p>`);
  }
  for (const id of node.turnInIds || []) {
    const quest = byId.quests.get(id);
    effects.push(`<p>Hands in <a href="#/quest/${id}">${esc(quest ? quest.title : "quest " + id)}</a></p>`);
  }
  const options = (node.options || []).map((option) => {
    const next = option.next === "1" ? "end" : encodeURIComponent(option.next);
    return `<a class="choice" href="#/npc/${npc.id}/${next}">${esc(option.text)}</a>`;
  }).join("");
  const restart = key === npc.conversation ? "" : `<p><a href="#/npc/${npc.id}">Start over</a></p>`;
  return `<div class="talk">
    <div class="talk-portrait">${icon(portrait, false, true)}</div>
    <p class="line">${esc(node.title)}</p>
    ${effects.join("")}
    <div class="choices">${options || "<p>The conversation ends.</p>"}</div>
    ${restart}
  </div>`;
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


let WORLD = null;
let worldLoad = null;
let mapToken = 0;

function loadWorld() {
  if (WORLD) return Promise.resolve(WORLD);
  if (!worldLoad) {
    worldLoad = fetch("data/world.json").then((res) => {
      if (!res.ok) throw new Error("Map failed to load (" + res.status + ").");
      return res.json();
    }).then((data) => {
      const at = new Map();
      const buckets = new Map();
      for (const cell of data.cells) {
        const rec = {
          x: cell[0], y: cell[1], gi: cell[2], fi: cell[3], ni: cell[4], col: cell[5], ei: cell[6],
        };
        at.set(rec.x + "," + rec.y, rec);
        const key = (rec.x >> 3) + "," + (rec.y >> 3);
        let bucket = buckets.get(key);
        if (!bucket) buckets.set(key, bucket = []);
        bucket.push(rec);
      }
      data.at = at;
      data.buckets = buckets;
      delete data.cells;
      WORLD = data;
      return data;
    });
  }
  return worldLoad;
}

function viewMap() {
  return `
    <h1>World</h1>
    <p class="lede">Drag to move. Scroll or pinch to zoom. Tap a tile for its name.</p>
    <div class="sorts">
      <button type="button" id="map-out">Zoom out</button>
      <button type="button" id="map-in">Zoom in</button>
      <button type="button" id="map-fit">Whole map</button>
    </div>
    <div class="map-stage"><canvas id="map" aria-label="BrawlQuest world map"></canvas></div>
    <div id="map-info" class="note">Loading the map…</div>`;
}

function initMap() {
  const token = ++mapToken;
  const canvas = document.getElementById("map");
  const info = document.getElementById("map-info");
  if (!canvas || !info) return;
  const ctx = canvas.getContext("2d");
  const images = new Map();
  const overview = new Image();
  let overviewReady = false;
  overview.onload = () => {
    overviewReady = true;
    if (token === mapToken) draw();
  };
  overview.src = "assets/world/overview.png";

  let cssW = 1;
  let cssH = 1;
  let zoom = 1;
  let camX = 0;
  let camY = 0;
  let selected = null;
  let world = null;
  const mobByName = new Map();
  for (const mob of DB.mobs) {
    if (!mobByName.has(mob.name)) mobByName.set(mob.name, mob);
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    cssW = Math.max(1, rect.width);
    cssH = Math.max(1, rect.height);
    const bw = Math.max(1, Math.round(cssW * dpr));
    const bh = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function clampZoom(value) {
    return Math.min(4, Math.max(0.02, value));
  }

  function fit() {
    if (!world) return;
    const spanX = (world.maxX - world.minX + 1) * world.tile;
    const spanY = (world.maxY - world.minY + 1) * world.tile;
    zoom = clampZoom(Math.min(cssW / spanX, cssH / spanY) * 0.96);
    camX = (world.minX + world.maxX + 1) * (world.tile / 2);
    camY = (world.minY + world.maxY + 1) * (world.tile / 2);
  }

  function screenToWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return {
      x: camX + (sx - cssW / 2) / zoom,
      y: camY + (sy - cssH / 2) / zoom,
      sx,
      sy,
    };
  }

  function sprite(path) {
    if (!path) return null;
    let image = images.get(path);
    if (!image) {
      image = new Image();
      image.onload = () => {
        if (token === mapToken) draw();
      };
      image.src = imgUrl(path);
      images.set(path, image);
    }
    return image.complete && image.naturalWidth ? image : null;
  }

  function tileAt(x, y) {
    return world ? world.at.get(x + "," + y) || null : null;
  }

  function showInfo(tile, x, y) {
    if (!world) return;
    if (!tile) {
      info.innerHTML = `<p>X ${num(x)}, Y ${num(y)}</p><p>No tile there.</p>`;
      return;
    }
    const name = world.names[tile.ni] || "—";
    const enemy = world.enemies[tile.ei] || "";
    let enemyHtml = "—";
    if (enemy) {
      const mob = mobByName.get(enemy);
      enemyHtml = mob ? `<a href="#/mob/${mob.id}">${esc(enemy)}</a>` : esc(enemy);
    }
    info.innerHTML = `<p><b>${esc(name || "—")}</b></p><p>X ${num(tile.x)}, Y ${num(tile.y)}</p><p>Collision: ${tile.col ? "yes" : "no"}</p><p>Enemy: ${enemyHtml}</p>`;
  }

  function draw() {
    if (token !== mapToken) return;
    resize();
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cssW, cssH);
    if (!world) return;
    const tile = world.tile;
    const tilePx = tile * zoom;
    if (overviewReady && tilePx < 4) {
      const ox = (world.minX * tile - camX) * zoom + cssW / 2;
      const oy = (world.minY * tile - camY) * zoom + cssH / 2;
      const ow = (world.maxX - world.minX + 1) * tilePx;
      const oh = (world.maxY - world.minY + 1) * tilePx;
      ctx.drawImage(overview, ox, oy, ow, oh);
    } else {
      const x0 = Math.floor((camX - cssW / 2 / zoom) / tile) - 1;
      const y0 = Math.floor((camY - cssH / 2 / zoom) / tile) - 1;
      const x1 = Math.floor((camX + cssW / 2 / zoom) / tile) + 1;
      const y1 = Math.floor((camY + cssH / 2 / zoom) / tile) + 1;
      const size = Math.ceil(tilePx);
      for (let cx = x0 >> 3; cx <= x1 >> 3; cx++) {
        for (let cy = y0 >> 3; cy <= y1 >> 3; cy++) {
          const bucket = world.buckets.get(cx + "," + cy);
          if (!bucket) continue;
          for (const cell of bucket) {
            if (cell.x < x0 || cell.x > x1 || cell.y < y0 || cell.y > y1) continue;
            const sx = Math.round((cell.x * tile - camX) * zoom + cssW / 2);
            const sy = Math.round((cell.y * tile - camY) * zoom + cssH / 2);
            const ground = sprite(world.grounds[cell.gi]);
            const fore = sprite(world.fores[cell.fi]);
            if (ground) ctx.drawImage(ground, sx, sy, size, size);
            if (fore) ctx.drawImage(fore, sx, sy, size, size);
          }
        }
      }
    }
    if (selected) {
      const sx = Math.round((selected.x * tile - camX) * zoom + cssW / 2);
      const sy = Math.round((selected.y * tile - camY) * zoom + cssH / 2);
      const size = Math.max(2, Math.ceil(tilePx));
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.strokeRect(sx + 1, sy + 1, Math.max(1, size - 2), Math.max(1, size - 2));
    }
  }

  function zoomAt(clientX, clientY, next) {
    const before = screenToWorld(clientX, clientY);
    zoom = clampZoom(next);
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    camX = before.x - (sx - cssW / 2) / zoom;
    camY = before.y - (sy - cssH / 2) / zoom;
    draw();
  }

  const pointers = new Map();
  let drag = null;
  let pinch = null;

  canvas.addEventListener("pointerdown", (event) => {
    if (token !== mapToken) return;
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size >= 2) {
      drag = null;
      pinch = null;
      canvas.classList.add("dragging");
    } else {
      drag = { x: event.clientX, y: event.clientY, camX, camY, moved: false };
      canvas.classList.add("dragging");
    }
  });
  canvas.addEventListener("pointermove", (event) => {
    if (token !== mapToken || !pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size >= 2) {
      const pts = [...pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      if (!pinch) {
        const worldPoint = screenToWorld(midX, midY);
        pinch = { dist, zoom, wx: worldPoint.x, wy: worldPoint.y };
      }
      zoom = clampZoom(pinch.zoom * (dist / pinch.dist));
      const rect = canvas.getBoundingClientRect();
      camX = pinch.wx - (midX - rect.left - cssW / 2) / zoom;
      camY = pinch.wy - (midY - rect.top - cssH / 2) / zoom;
      draw();
      return;
    }
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (dx * dx + dy * dy > 16) drag.moved = true;
    camX = drag.camX - dx / zoom;
    camY = drag.camY - dy / zoom;
    draw();
  });
  function endPointer(event) {
    if (!pointers.has(event.pointerId)) return;
    const wasDrag = drag;
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      canvas.classList.remove("dragging");
      if (wasDrag && !wasDrag.moved && world) {
        const point = screenToWorld(event.clientX, event.clientY);
        const tx = Math.floor(point.x / world.tile);
        const ty = Math.floor(point.y / world.tile);
        selected = tileAt(tx, ty) || { x: tx, y: ty, empty: true };
        showInfo(selected.empty ? null : selected, tx, ty);
        draw();
      }
      drag = null;
    } else if (pointers.size === 1) {
      const left = [...pointers.values()][0];
      drag = { x: left.x, y: left.y, camX, camY, moved: true };
    }
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("wheel", (event) => {
    if (token !== mapToken) return;
    event.preventDefault();
    let dy = event.deltaY;
    if (event.deltaMode === 1) dy *= 16;
    else if (event.deltaMode === 2) dy *= cssH;
    zoomAt(event.clientX, event.clientY, zoom * Math.exp(-dy * 0.0015));
  }, { passive: false });

  document.getElementById("map-in").addEventListener("click", () => {
    zoomAt(canvas.getBoundingClientRect().left + cssW / 2, canvas.getBoundingClientRect().top + cssH / 2, zoom * 1.25);
  });
  document.getElementById("map-out").addEventListener("click", () => {
    const rect = canvas.getBoundingClientRect();
    zoomAt(rect.left + cssW / 2, rect.top + cssH / 2, zoom / 1.25);
  });
  document.getElementById("map-fit").addEventListener("click", () => {
    fit();
    draw();
  });

  function onKey(event) {
    if (token !== mapToken) {
      window.removeEventListener("keydown", onKey);
      return;
    }
    if (event.key === "ArrowLeft") camX -= 64;
    else if (event.key === "ArrowRight") camX += 64;
    else if (event.key === "ArrowUp") camY -= 64;
    else if (event.key === "ArrowDown") camY += 64;
    else if (event.key === "+" || event.key === "=") zoom = clampZoom(zoom * 1.25);
    else if (event.key === "-" || event.key === "_") zoom = clampZoom(zoom / 1.25);
    else return;
    event.preventDefault();
    draw();
  }
  window.addEventListener("keydown", onKey);
  const onResize = () => {
    if (token !== mapToken) {
      window.removeEventListener("resize", onResize);
      return;
    }
    draw();
  };
  window.addEventListener("resize", onResize);

  resize();
  loadWorld().then((data) => {
    if (token !== mapToken) return;
    world = data;
    fit();
    info.textContent = "Tap a tile. Drag to move. Scroll or pinch to zoom.";
    draw();
  }).catch((err) => {
    if (token !== mapToken) return;
    info.innerHTML = `<p class="err">${esc(err.message || "Could not load the map.")}</p>`;
  });
}
