#!/usr/bin/env python3
"""Regenerate the BrawlQuest Armoury static data.

Reads the content catalogue, the players table, and inventory rows whose
item type is mount or buddy. Does not copy either sqlite database, and never
selects passwords, UID, Owner, coordinates, hotbar, or any other inventory.

Usage (from this folder): python3 generate.py
"""

from __future__ import annotations

import json
import re
import shutil
import sqlite3
import struct
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


def png_size(path: Path):
    with path.open("rb") as handle:
        handle.read(16)
        return struct.unpack(">II", handle.read(8))


def sibling_png(img: str, name: str) -> str:
    parent = str(Path(img).parent).replace("\\", "/")
    return f"{parent}/{name}"


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
            "w": 0,
            "h": 0,
            "setId": None,
            "drops": [],
        })
        if img and (CLIENT_ROOT / img).is_file():
            items[-1]["w"], items[-1]["h"] = png_size(CLIENT_ROOT / img)
        if (row["Type"] or "") == "mount" and img:
            back = sibling_png(img, "back.png")
            fore = sibling_png(img, "fore.png")
            items[-1]["boat"] = "boat" in (row["Name"] or "").lower()
            items[-1]["mountBack"] = back
            items[-1]["mountFore"] = fore if (CLIENT_ROOT / fore).is_file() else None
            if (CLIENT_ROOT / back).is_file():
                items[-1]["mountBackW"], items[-1]["mountBackH"] = png_size(CLIENT_ROOT / back)
            else:
                items[-1]["mountBackW"] = items[-1]["mountBackH"] = 0
            if items[-1]["mountFore"]:
                items[-1]["mountForeW"], items[-1]["mountForeH"] = png_size(CLIENT_ROOT / items[-1]["mountFore"])
            else:
                items[-1]["mountForeW"] = items[-1]["mountForeH"] = 0

    sets = derive_sets(items)
    set_by_item = {}
    for group in sets:
        for item_id in group["itemIds"]:
            set_by_item[item_id] = group["id"]
    for it in items:
        it["setId"] = set_by_item.get(it["id"])

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

    enemy_by_name = {}
    for row in enemy_rows:
        enemy_by_name[(row["Name"] or "").casefold()] = row["id"]
    spells_by_enemy = defaultdict(list)
    unmatched_spell_values = []
    for row in spell_rows:
        value = "" if row["Value"] is None else str(row["Value"])
        mob_id = enemy_by_name.get(value.casefold()) if value.strip() else None
        if value.strip() and mob_id is None and (row["Name"] or "").startswith("Spawn"):
            unmatched_spell_values.append({"enemyId": row["EnemyID"], "name": row["Name"], "value": value})
        spells_by_enemy[row["EnemyID"]].append({
            "name": row["Name"] or "",
            "value": value,
            "frequency": row["Frequency"],
            "mobId": mob_id,
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
        })
    for it in items:
        if it["img"]:
            image_paths.add(it["img"])
        if it.get("mountBack"):
            image_paths.add(it["mountBack"])
        if it.get("mountFore"):
            image_paths.add(it["mountFore"])
    image_paths.add("assets/player/base.png")
    image_paths.add("assets/player/gen/shield false.png")

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
            "mounts": [],
            "buddies": [],
        })

    mount_buddy = {it["id"]: it["type"] for it in items if it["type"] in ("mount", "buddy")}
    id_list = ",".join(str(i) for i in sorted(mount_buddy))
    # Inventory is limited to mount and buddy item ids. No other rows are read.
    inv_rows = users.execute(
        "SELECT id, PlayerID, ItemID, Amount FROM inventory "
        f"WHERE ItemID IN ({id_list}) ORDER BY id"
    ).fetchall() if id_list else []
    owned_amount = defaultdict(lambda: defaultdict(int))
    owned_order = defaultdict(list)
    for inv in inv_rows:
        if inv["ItemID"] not in mount_buddy:
            continue
        bucket = owned_amount[inv["PlayerID"]]
        if inv["ItemID"] not in bucket:
            owned_order[inv["PlayerID"]].append(inv["ItemID"])
        bucket[inv["ItemID"]] += inv["Amount"] or 0
    char_by_id = {ch["id"]: ch for ch in characters}
    for pid, order in owned_order.items():
        ch = char_by_id.get(pid)
        if not ch:
            continue
        for item_id in order:
            entry = {"itemId": item_id, "amount": owned_amount[pid][item_id]}
            kind = mount_buddy[item_id]
            if kind == "mount":
                ch["mounts"].append(entry)
            elif kind == "buddy":
                ch["buddies"].append(entry)

    recipes = []
    for row in content.execute("SELECT id, ItemID, Items, Chance FROM craft ORDER BY id"):
        try:
            raw_items = json.loads(row["Items"] or "[]")
        except json.JSONDecodeError:
            print("bad craft json", row["id"])
            continue
        recipes.append({
            "id": row["id"],
            "kind": "craft",
            "resultId": row["ItemID"],
            "chance": row["Chance"],
            "ingredients": [
                {"itemId": part.get("ItemID"), "amount": part.get("Amount")}
                for part in raw_items
            ],
        })
    # Forge rows are a straight conversion: the entered item becomes the result.
    for row in content.execute("SELECT id, EnterID, ResultID FROM forge ORDER BY id"):
        recipes.append({
            "id": f"forge-{row['id']}",
            "kind": "forge",
            "resultId": row["ResultID"],
            "chance": None,
            "ingredients": [{"itemId": row["EnterID"]}],
        })

    body_path = CLIENT_ROOT / "assets/player/base.png"
    shield_path = CLIENT_ROOT / "assets/player/gen/shield false.png"
    body_w, body_h = png_size(body_path) if body_path.is_file() else (0, 0)
    shield_w, shield_h = png_size(shield_path) if shield_path.is_file() else (0, 0)

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
            "rev": "20261004-doll",
            "doll": {
                "body": "assets/player/base.png",
                "bodyW": body_w,
                "bodyH": body_h,
                "shieldBack": "assets/player/gen/shield false.png",
                "shieldW": shield_w,
                "shieldH": shield_h,
            },
            "counts": {
                "items": len(items),
                "mobs": len(mobs),
                "sets": len(sets),
                "characters": len(characters),
                "loot": len(loot_rows),
                "spells": len(spell_rows),
                "recipes": len(recipes),
            },
        },
        "items": items,
        "mobs": mobs,
        "sets": sets,
        "recipes": recipes,
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
    print("recipes", len(recipes))
    print("unmatched spawn values", unmatched_spell_values)
    print("broken enemy loot", broken_enemies)
    print("broken item loot", broken_items)
    print("owned mounts", sum(len(ch["mounts"]) for ch in characters), "buddies", sum(len(ch["buddies"]) for ch in characters))
    print("json bytes", out.stat().st_size)
    # Guard: the sqlite files must not be written into the site.
    assert not list(ROOT.rglob("*.db"))


if __name__ == "__main__":
    main()
