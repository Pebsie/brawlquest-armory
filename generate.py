#!/usr/bin/env python3
"""Regenerate the BrawlQuest Armoury static data.

Reads the content catalogue and the players table only. Does not copy either
sqlite database, and never selects passwords, UID, Owner, coordinates,
inventory, or hotbar.

Usage (from this folder): python3 generate.py
"""

from __future__ import annotations

import json
import re
import shutil
import sqlite3
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONTENT_DB = Path("/workspace/BrawlQuest-API/bq-content.db")
USERS_DB = Path("/workspace/BrawlQuest-API/bq-users.db")
CLIENT_ROOT = Path("/workspace/BrawlQuest-Client")

GEAR_TYPES = {"wep", "arm_head", "arm_chest", "arm_legs", "shield"}
JUNK = {"a", "an", "the", "of", "and"}
# Single trailing words that are just a slot or weapon class, not a set name.
GENERIC_SUFFIX = {
    "sword", "dagger", "staff", "blade", "axe", "shield", "helmet", "chestplate",
    "leggings", "cloak", "robe", "pants", "shirt", "jacket", "stick", "trousers",
    "facemask", "ears", "head", "trident", "rod", "t-shirt",
}
# Remainder of a "Prefix Piece" name that still counts as one armour piece.
PIECE_REST = {
    "helmet", "chestplate", "leggings", "shield", "cloak", "pants", "shirt",
    "jacket", "ears", "robe", "trousers", "facemask", "t-shirt",
}

DROP_NOTE = (
    "Drop chance is an integer percent. The server rolls 0–99 and the item drops "
    "if the roll is lower than the chance, so 100 is certain and 1 is about 1%. "
    "Double-power is a random flag on a spawn, not a separate enemy, so no mob is "
    "marked as double-power here. A double-power spawn rolls 0–49 instead, which doubles those odds."
)
VARIANCE_NOTE = (
    "Amount variance of 0 is treated as 1. The extra amount is added only when the variance roll is greater than 1."
)
CRYSTAL_NOTE = (
    "Old World Crystal is excluded from double-drop events: a luck double drop and a happy-hour drop do not double its amount."
)
FISH_NOTE = (
    "Fish has a hardcoded extra drop that is not in this loot table. The server gives Pear, "
    "unless a roll of 1 on a 0–9 roll replaces it with a random catalogue item. "
    "The amount is a random whole number from 0 to 4."
)
PEAR_NOTE = (
    "Fish can grant Pear as a hardcoded extra drop (see Fish). On a roll of 1 on a 0–9 roll, that extra drop is a random catalogue item instead."
)


def parse_attrs(raw) -> list:
    if raw is None:
        return []
    text = str(raw).strip()
    if text in ("", "None"):
        return []
    parsed = []
    for part in text.split(";"):
        part = part.strip()
        if not part:
            continue
        if "," not in part:
            parsed.append({"stat": part, "value": None})
            continue
        stat, val = part.split(",", 1)
        val = val.strip()
        try:
            number = int(val)
        except ValueError:
            number = val
        parsed.append({"stat": stat.strip(), "value": number})
    return parsed


def blank_to_none(value):
    if value is None:
        return None
    text = str(value).strip()
    if text in ("", "None"):
        return None
    return text


def slug(text: str) -> str:
    text = text.lower().replace("'", "")
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text or "set"


def derive_sets(items: list) -> list:
    """Group gear that shares a clear name stem. A set needs at least two pieces.

    Passes, in order, so a stronger stem wins:
    1. Possessive prefix with two or more pieces (Bandit's Blade -> Bandit).
    2. Shared first word whose remainder is an armour piece (Studded Helmet).
    3. Shared trailing words, longest first (Letter Opener, Walking Staff, Pickaxe).
       Junk stems (a, the, of) and generic slot words (sword, staff, helmet) are skipped.
    """
    gear = [it for it in items if it["type"] in GEAR_TYPES]
    assigned: set[int] = set()
    groups: list[tuple[str, list]] = []

    possessive = defaultdict(list)
    for it in gear:
        match = re.match(r"^(.+?)'s\s+", it["name"].replace("’", "'"))
        if match:
            stem = match.group(1).strip()
            if stem.lower() not in JUNK:
                possessive[stem].append(it)
    for stem, members in sorted(possessive.items(), key=lambda kv: kv[0].lower()):
        if len(members) >= 2:
            groups.append((stem, members))
            assigned.update(m["id"] for m in members)

    first_word = defaultdict(list)
    for it in gear:
        if it["id"] in assigned:
            continue
        parts = it["name"].replace("’", "'").split()
        if len(parts) < 2:
            continue
        stem, rest = parts[0], " ".join(parts[1:]).lower()
        if stem.lower() in JUNK:
            continue
        if rest in PIECE_REST:
            first_word[stem].append(it)
    for stem, members in sorted(first_word.items(), key=lambda kv: kv[0].lower()):
        if len(members) >= 2:
            groups.append((stem, members))
            assigned.update(m["id"] for m in members)

    remaining = [it for it in gear if it["id"] not in assigned]
    buckets: dict[tuple[int, str], list] = defaultdict(list)
    for it in remaining:
        words = it["name"].replace("’", "'").split()
        for n in (3, 2, 1):
            if len(words) < n:
                continue
            suffix = " ".join(words[-n:])
            tokens = [w.lower().strip("'") for w in suffix.split()]
            if any(tok in JUNK for tok in tokens):
                continue
            if n == 1 and tokens[0] in GENERIC_SUFFIX:
                continue
            buckets[(n, suffix)].append(it)

    used: set[int] = set()
    suffix_groups: list[tuple[str, list]] = []
    for n, suffix in sorted(buckets, key=lambda key: (-key[0], key[1].lower())):
        members = [it for it in buckets[(n, suffix)] if it["id"] not in used]
        if len(members) < 2:
            continue
        suffix_groups.append((suffix, members))
        used.update(it["id"] for it in members)
    groups.extend(sorted(suffix_groups, key=lambda kv: kv[0].lower()))

    sets = []
    seen_slugs: set[str] = set()
    for name, members in groups:
        set_id = slug(name)
        base = set_id
        i = 2
        while set_id in seen_slugs:
            set_id = f"{base}-{i}"
            i += 1
        seen_slugs.add(set_id)
        members = sorted(members, key=lambda it: (it["name"].lower(), it["id"]))
        sets.append({
            "id": set_id,
            "name": name,
            "itemIds": [it["id"] for it in members],
        })
    sets.sort(key=lambda s: s["name"].lower())
    return sets


def main() -> None:
    content = sqlite3.connect(CONTENT_DB)
    content.row_factory = sqlite3.Row
    users = sqlite3.connect(USERS_DB)
    users.row_factory = sqlite3.Row

    item_rows = content.execute(
        "SELECT id, Name, Type, Val, ImgPath, Desc, Worth, Attributes, Subtype, Cooldown "
        "FROM items ORDER BY id"
    ).fetchall()
    enemy_rows = content.execute(
        "SELECT id, Name, ATK, Image, HP, Range, CanMove, XP, Attributes FROM enemies ORDER BY id"
    ).fetchall()
    loot_rows = content.execute(
        "SELECT id, EnemyID, ItemID, Chance, Amount, AmountVariance FROM loot "
        "ORDER BY EnemyID, ItemID, Chance, Amount, id"
    ).fetchall()
    spell_rows = content.execute(
        "SELECT id, EnemyID, Name, Value, Frequency FROM enemySpells ORDER BY EnemyID, id"
    ).fetchall()
    # Players table only. Do not select Owner, X, Y, or anything from users.
    player_rows = users.execute(
        "SELECT id, Name, LVL, XP, STR, INT, STA, Class, IsHardcore, Prestige, "
        "WeaponID, LegArmourID, ChestArmourID, HeadArmourID, ShieldID, Buddy "
        "FROM players ORDER BY id"
    ).fetchall()

    items = []
    for row in item_rows:
        img = row["ImgPath"] or ""
        items.append({
            "id": row["id"],
            "name": row["Name"] or "",
            "type": row["Type"] or "",
            "subtype": blank_to_none(row["Subtype"]),
            "val": row["Val"],
            "worth": row["Worth"],
            "cooldown": row["Cooldown"],
            "desc": row["Desc"] or "",
            "attributes": parse_attrs(row["Attributes"]),
            "img": img,
            "imgMissing": not (img and (CLIENT_ROOT / img).is_file()),
            "setId": None,
            "note": None,
            "drops": [],
        })

    sets = derive_sets(items)
    set_by_item = {}
    for group in sets:
        for item_id in group["itemIds"]:
            set_by_item[item_id] = group["id"]
    for it in items:
        it["setId"] = set_by_item.get(it["id"])
        if it["id"] == 53:
            it["note"] = CRYSTAL_NOTE
        elif it["id"] == 23:
            it["note"] = PEAR_NOTE

    enemy_ids = {row["id"] for row in enemy_rows}
    item_ids = {it["id"] for it in items}
    drops_by_item = defaultdict(list)
    drops_by_enemy = defaultdict(list)
    broken_enemies = []
    broken_items = []
    for row in loot_rows:
        drop = {
            "lootId": row["id"],
            "enemyId": row["EnemyID"],
            "itemId": row["ItemID"],
            "chance": row["Chance"],
            "amount": row["Amount"],
            "variance": row["AmountVariance"],
        }
        if row["EnemyID"] not in enemy_ids:
            broken_enemies.append(drop)
        if row["ItemID"] not in item_ids:
            broken_items.append(drop)
        drops_by_item[row["ItemID"]].append({
            "enemyId": row["EnemyID"],
            "chance": row["Chance"],
            "amount": row["Amount"],
            "variance": row["AmountVariance"],
        })
        drops_by_enemy[row["EnemyID"]].append({
            "itemId": row["ItemID"],
            "chance": row["Chance"],
            "amount": row["Amount"],
            "variance": row["AmountVariance"],
        })
    for it in items:
        it["drops"] = drops_by_item.get(it["id"], [])

    spells_by_enemy = defaultdict(list)
    for row in spell_rows:
        spells_by_enemy[row["EnemyID"]].append({
            "name": row["Name"] or "",
            "value": "" if row["Value"] is None else str(row["Value"]),
            "frequency": row["Frequency"],
        })

    mobs = []
    image_paths = set()
    for row in enemy_rows:
        img = row["Image"] or ""
        if img:
            image_paths.add(img)
        mobs.append({
            "id": row["id"],
            "name": row["Name"] or "",
            "hp": row["HP"],
            "atk": row["ATK"],
            "xp": row["XP"],
            "range": row["Range"],
            "canMove": bool(row["CanMove"]),
            "attributes": parse_attrs(row["Attributes"]),
            "img": img,
            "imgMissing": not (img and (CLIENT_ROOT / img).is_file()),
            "spells": spells_by_enemy.get(row["id"], []),
            "drops": drops_by_enemy.get(row["id"], []),
            "note": FISH_NOTE if (row["Name"] or "") == "Fish" else None,
        })
    for it in items:
        if it["img"]:
            image_paths.add(it["img"])

    by_img = defaultdict(list)
    for it in items:
        if it["img"]:
            by_img[it["img"]].append(it["id"])

    characters = []
    for row in player_rows:
        buddy = row["Buddy"]
        buddy_ids = []
        if buddy and buddy != "None":
            buddy_ids = list(by_img.get(buddy, []))
        characters.append({
            "id": row["id"],
            "name": row["Name"] or "",
            "level": row["LVL"],
            "xp": row["XP"],
            "class": row["Class"] if row["Class"] not in (None, "") else "None",
            "str": row["STR"],
            "int": row["INT"],
            "sta": row["STA"],
            "hardcore": bool(row["IsHardcore"]),
            "prestige": row["Prestige"],
            "weaponId": row["WeaponID"] or 0,
            "headId": row["HeadArmourID"] or 0,
            "chestId": row["ChestArmourID"] or 0,
            "legsId": row["LegArmourID"] or 0,
            "shieldId": row["ShieldID"] or 0,
            "buddyIds": buddy_ids,
        })

    missing_images = sorted(p for p in image_paths if not (CLIENT_ROOT / p).is_file())
    copied = 0
    assets_dir = ROOT / "assets"
    if assets_dir.exists():
        shutil.rmtree(assets_dir)
    for rel in sorted(image_paths):
        src = CLIENT_ROOT / rel
        if not src.is_file():
            continue
        dest = ROOT / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        copied += 1

    payload = {
        "meta": {
            "dropNote": DROP_NOTE,
            "varianceNote": VARIANCE_NOTE,
            "counts": {
                "items": len(items),
                "mobs": len(mobs),
                "sets": len(sets),
                "characters": len(characters),
                "loot": len(loot_rows),
                "spells": len(spell_rows),
            },
        },
        "items": items,
        "mobs": mobs,
        "sets": sets,
        "characters": characters,
    }
    out = ROOT / "data" / "armory.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print("items", len(items))
    print("mobs", len(mobs))
    print("loot", len(loot_rows))
    print("spells", len(spell_rows))
    print("characters", len(characters))
    print("sets", len(sets))
    for group in sets:
        names = [next(it["name"] for it in items if it["id"] == i) for i in group["itemIds"]]
        print(f"  {group['id']}: {group['name']} -> {names}")
    print("missing images", missing_images)
    print("copied images", copied)
    print("broken enemy loot", broken_enemies)
    print("broken item loot", broken_items)
    print("json bytes", out.stat().st_size)
    # Guard: the sqlite files must not be written into the site.
    assert not list(ROOT.rglob("*.db"))


if __name__ == "__main__":
    main()
