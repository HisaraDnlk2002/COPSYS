// Single source of truth for what the armory can stock, mirrored from
// server/src/config/weaponCatalog.js. Keep both in sync.

export const AMMUNITION_CATEGORY = "Ammunition";

export const WEAPON_CATALOG = [
  {
    category: "Firearms",
    types: ["Pistol", "Revolver", "Shotgun", "Assault Rifle", "Submachine Gun", "Rifle", "Sniper Rifle"],
  },
  {
    category: "Less-Lethal / Control Equipment",
    types: ["Baton", "Pepper Spray", "Taser / Conducted-Energy Device", "Tear-Gas Launcher"],
  },
  {
    category: "Other Weapons",
    types: ["Police Knife", "Riot-Control Shield", "Other Authorized Weapon"],
  },
  {
    category: AMMUNITION_CATEGORY,
    types: [
      "9mm Ammunition",
      ".38 Ammunition",
      "5.56mm Ammunition",
      "7.62mm Ammunition",
      "Shotgun Shells",
      "Other Authorized Ammunition",
    ],
  },
];

export const WEAPON_CATEGORIES = WEAPON_CATALOG.map((c) => c.category).filter((c) => c !== AMMUNITION_CATEGORY);

export function typesForCategory(category) {
  return WEAPON_CATALOG.find((c) => c.category === category)?.types || [];
}

// Caliber(s) each firearm type can fire, in line with the Ammunition
// types above. A single entry means the caliber is set automatically on
// registration; only types built in more than one caliber (e.g. T-56 is
// 7.62mm, M16 is 5.56mm — both "Assault Rifle") ask for it.
export const CALIBERS_BY_TYPE = {
  Pistol: ["9mm"],
  Revolver: [".38"],
  Shotgun: ["12 Gauge"],
  "Assault Rifle": ["5.56mm", "7.62mm"],
  "Submachine Gun": ["9mm"],
  Rifle: ["7.62mm", "5.56mm"],
  "Sniper Rifle": ["7.62mm"],
};

// Where items can be stored at the station. Edit this list (here and in
// the server copy) to match the station's actual armory layout.
export const STORAGE_LOCATIONS = [
  "Main Armory — Rack A",
  "Main Armory — Rack B",
  "Main Armory — Rack C",
  "Firearms Safe",
  "Ammunition Store",
  "Less-Lethal Equipment Locker",
  "Riot Gear Store",
  "Duty Officer's Safe",
];

export function calibersForType(type) {
  return CALIBERS_BY_TYPE[type] || [];
}

// Accessories that can go out with each weapon type — ticked on the Issue
// form and checked off again on return.
export const ACCESSORIES_BY_TYPE = {
  Pistol: ["Holster", "Magazine", "Spare Magazine", "Magazine Pouch", "Lanyard", "Cleaning Kit"],
  Revolver: ["Holster", "Speed Loader", "Lanyard", "Cleaning Kit"],
  Shotgun: ["Sling", "Shell Holder", "Cleaning Kit"],
  "Assault Rifle": ["Sling", "Magazine", "Spare Magazine", "Magazine Pouch", "Bayonet", "Cleaning Kit"],
  "Submachine Gun": ["Sling", "Magazine", "Spare Magazine", "Magazine Pouch", "Cleaning Kit"],
  Rifle: ["Sling", "Magazine", "Spare Magazine", "Cleaning Kit"],
  "Sniper Rifle": ["Scope", "Bipod", "Sling", "Magazine", "Spare Magazine", "Carry Case", "Cleaning Kit"],
  Baton: ["Baton Holder"],
  "Pepper Spray": ["Holster"],
  "Taser / Conducted-Energy Device": ["Holster", "Spare Cartridge", "Battery Pack"],
  "Tear-Gas Launcher": ["Sling", "Carry Case"],
  "Police Knife": ["Sheath"],
  "Riot-Control Shield": ["Carry Strap"],
  "Other Authorized Weapon": ["Holster", "Sling", "Carry Case"],
};

export function accessoriesForType(type) {
  return ACCESSORIES_BY_TYPE[type] || [];
}
