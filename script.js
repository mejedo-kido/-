// Hack & Loot Drop Simulator
// Data-driven, browser-only ES2022 implementation.  All balance knobs live in data/*.json
// so new affixes, enemies, rarities, and drop behavior can be added without changing code.

const STAT_LABELS = {
  level: 'Lv', attack: '攻撃', defense: '防御', hp: 'HP', mp: 'MP', dps: 'DPS',
  critRate: 'クリ率', critDamage: 'クリダメ', attackSpeed: '攻撃速度', accuracy: '命中',
  evasion: '回避', lifeSteal: 'ライフ吸収', dropRate: 'ドロップ率', expRate: '経験値倍率',
  goldRate: 'ゴールド倍率', fireDamage: '炎属性', iceDamage: '氷属性',
  lightningDamage: '雷属性', lightDamage: '光属性', darkDamage: '闇属性',
  poisonDamage: '毒', block: 'ブロック', rarityFind: 'レア倍率'
};

const SLOTS = { weapon: '武器', shield: '盾', armor: '防具', accessory: 'アクセ' };
const BASE_STATS = {
  level: 1, attack: 12, defense: 6, hp: 140, mp: 40, attackSpeed: 1,
  critRate: 5, critDamage: 150, accuracy: 95, evasion: 2, lifeSteal: 0,
  dropRate: 0, expRate: 0, goldRate: 0, rarityFind: 0
};

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const pick = (array) => array[Math.floor(Math.random() * array.length)];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const formatSigned = (value) => `${value >= 0 ? '+' : ''}${value}`;

function addStats(base, bonus, multiplier = 1) {
  const merged = { ...base };
  Object.entries(bonus ?? {}).forEach(([key, value]) => {
    merged[key] = (merged[key] ?? 0) + value * multiplier;
  });
  return merged;
}

class DataStore {
  async load() {
    const names = ['prefix', 'modifier', 'suffix', 'rarity', 'enemies', 'effects', 'dropTable'];
    const payloads = await Promise.all(
      names.map(async (name) => {
        const response = await fetch(`data/${name}.json`);
        if (!response.ok) throw new Error(`${name}.json の読み込みに失敗しました。`);
        return response.json();
      })
    );
    names.forEach((name, index) => { this[name] = payloads[index]; });
  }
}

class Item {
  constructor(raw) { Object.assign(this, raw); }
  get power() {
    return (this.stats.attack ?? 0) * 2 + (this.stats.defense ?? 0) * 1.5 +
      (this.stats.hp ?? 0) / 8 + (this.stats.critRate ?? 0) * 4 +
      (this.stats.attackSpeed ?? 0) * 4 + (this.stats.dropRate ?? 0) * 1.2;
  }
}

class ItemGenerator {
  constructor(data) { this.data = data; }

  rollRarity(enemy, playerStats) {
    const rareBonus = 1 + (playerStats.rarityFind ?? 0) / 100;
    const pool = this.data.rarity.map((rarity) => ({
      ...rarity,
      weightScore: rarity.weight * (rarity.rank ? enemy.rareMultiplier * rareBonus : 1)
    }));
    const total = pool.reduce((sum, rarity) => sum + rarity.weightScore, 0);
    let roll = Math.random() * total;
    return pool.find((rarity) => (roll -= rarity.weightScore) <= 0) ?? pool[0];
  }

  generate(level, enemy, forcedRarity = null) {
    const prefix = pick(this.data.prefix);
    const modifier = pick(this.data.modifier);
    const suffix = pick(this.data.suffix);
    const rarity = forcedRarity ?? this.rollRarity(enemy, { rarityFind: 0 });
    let stats = addStats(addStats(prefix.stats, modifier.stats), suffix.stats);

    for (let i = 0; i < rarity.extraStats; i += 1) {
      const key = pick(modifier.variable ?? ['attack']);
      stats[key] = (stats[key] ?? 0) + 4 + Math.floor(Math.random() * 10);
    }

    const scale = (1 + level * this.data.dropTable.levelScale) * rarity.multiplier;
    Object.keys(stats).forEach((key) => { stats[key] = Math.max(1, Math.round(stats[key] * scale)); });

    return new Item({
      id: uid(), name: `${prefix.name}${modifier.name}${suffix.name}`,
      prefix: prefix.name, modifier: modifier.name, suffix: suffix.name, slot: suffix.slot,
      rarity: rarity.name, rank: rarity.rank, color: rarity.color, level, stats,
      value: Math.round(rarity.sell * (1 + level * 0.25)), material: rarity.material,
      createdAt: Date.now()
    });
  }
}

class Inventory {
  constructor(max) { this.max = max; this.items = []; this.selected = new Set(); }
  add(items) {
    for (const item of items) {
      if (this.items.length >= this.max) this.items.shift();
      this.items.push(item);
    }
  }
  remove(ids) {
    this.items = this.items.filter((item) => !ids.includes(item.id));
    ids.forEach((id) => this.selected.delete(id));
  }
}

class Player {
  constructor() {
    this.gold = 0;
    this.materials = 0;
    this.equipment = { weapon: null, shield: null, armor: null, accessory: null };
  }
  equip(item) {
    const previous = this.equipment[item.slot];
    this.equipment[item.slot] = item;
    return previous;
  }
  stats() {
    let output = { ...BASE_STATS };
    Object.values(this.equipment).filter(Boolean).forEach((item) => { output = addStats(output, item.stats); });
    output.dps = Math.round(output.attack * output.attackSpeed * (1 + output.critRate / 100 * (output.critDamage / 100 - 1)));
    return output;
  }
}

class Enemy {
  constructor(data, wave) {
    Object.assign(this, data);
    this.maxHp = Math.round(data.hp * (1 + wave * 0.22));
    this.hp = this.maxHp;
  }
}

class Battle {
  constructor(app) { this.app = app; this.wave = 1; this.spawn(); }
  spawn() { this.enemy = new Enemy(pick(this.app.data.enemies), this.wave); }
  attack() {
    const stats = this.app.player.stats();
    const isHit = Math.random() * 100 < stats.accuracy;
    if (!isHit) { this.app.ui.log('攻撃は外れた！'); this.app.ui.render(); return; }
    const isCritical = Math.random() * 100 < stats.critRate;
    const damage = Math.max(1, Math.round(stats.attack * (isCritical ? stats.critDamage / 100 : 1)));
    this.enemy.hp -= damage;
    this.app.ui.log(`攻撃 ${damage}${isCritical ? ' CRITICAL' : ''} ダメージ`);
    if (this.enemy.hp <= 0) this.defeat();
    this.app.ui.render();
  }
  defeat() {
    this.app.ui.log(`${this.enemy.name}を撃破！`);
    const drops = this.app.drop.roll(this.enemy, this.wave);
    this.app.inventory.add(drops);
    drops.forEach((item) => this.app.ui.logDrop(item));
    this.wave += 1;
    this.spawn();
    this.app.save.auto();
  }
}

class DropManager {
  constructor(app) { this.app = app; this.killCount = 0; }
  roll(enemy, wave) {
    this.killCount += 1;
    const stats = this.app.player.stats();
    const extraDrops = Math.floor(stats.dropRate / 30);
    const dropCount = this.app.data.dropTable.baseDrops + Math.floor(Math.random() * enemy.dropMultiplier) + extraDrops;
    return Array.from({ length: dropCount }, () => {
      const pity = this.killCount % this.app.data.dropTable.rarePityEvery === 0 ? this.app.data.rarity[2] : null;
      return this.app.generator.generate(enemy.level + wave, enemy, pity);
    });
  }
}

class FusionManager {
  constructor(app) { this.app = app; }
  fuse() {
    const selected = this.app.inventory.items.filter((item) => this.app.inventory.selected.has(item.id));
    if (selected.length !== 5) return this.app.ui.log('合成は同一レアリティ・同一装備種を5個選択してください。');
    const [first] = selected;
    if (!selected.every((item) => item.rarity === first.rarity && item.suffix === first.suffix)) {
      return this.app.ui.log('同じレアリティ・同じ装備種のみ合成可能です。');
    }
    const sourceRarity = this.app.data.rarity.find((rarity) => rarity.name === first.rarity);
    if (!sourceRarity.fusion) return this.app.ui.log('これ以上合成できません。');

    this.app.inventory.remove(selected.map((item) => item.id));
    const roll = Math.random() * 100;
    if (roll < sourceRarity.fusion.fail) { this.app.ui.effect('失敗...', false); this.app.ui.render(); return; }

    const jump = roll < sourceRarity.fusion.fail + sourceRarity.fusion.great ? 2 : 1;
    const resultRarity = this.app.data.rarity[Math.min(sourceRarity.rank + jump, this.app.data.rarity.length - 1)];
    const result = this.app.generator.generate(first.level + 2, { rareMultiplier: 1 }, resultRarity);
    this.app.inventory.add([result]);
    this.app.ui.effect(jump === 2 ? '超成功!!' : '成功!', jump === 2);
    this.app.ui.logDrop(result);
    this.app.ui.render();
  }
}

class CraftManager {
  // Future expansion point for recipes, set bonuses, enchants, and unique equipment.
  constructor(app) { this.app = app; }
}

class SaveManager {
  constructor(app) { this.app = app; this.key = 'hackslash-save-v2'; }
  auto() {
    localStorage.setItem(this.key, JSON.stringify({
      player: this.app.player,
      inventory: this.app.inventory.items,
      wave: this.app.battle.wave
    }));
  }
  load() {
    const saved = JSON.parse(localStorage.getItem(this.key) ?? 'null');
    if (!saved) return;
    this.app.player.gold = saved.player.gold ?? 0;
    this.app.player.materials = saved.player.materials ?? 0;
    this.app.player.equipment = saved.player.equipment ?? this.app.player.equipment;
    this.app.inventory.items = (saved.inventory ?? []).map((item) => new Item(item));
    this.app.battle.wave = saved.wave ?? 1;
    this.app.battle.spawn();
  }
}

class EffectManager {
  constructor(root) { this.root = root; }
  burst(text, big = false) {
    const element = document.createElement('div');
    element.className = `burst ${big ? 'burst-big' : ''}`;
    element.textContent = text;
    this.root.append(element);
    if (big) document.body.classList.add('shake');
    setTimeout(() => { element.remove(); document.body.classList.remove('shake'); }, 950);
  }
}

class SoundManager {
  // No external audio assets are required; WebAudio can be enabled here later.
  playCue() {}
}

class UIManager {
  constructor(app) { this.app = app; this.$ = (id) => document.getElementById(id); }
  bind() {
    this.$('attackButton').onclick = () => this.app.battle.attack();
    this.$('clearLogButton').onclick = () => { this.$('dropLog').innerHTML = ''; };
    ['searchInput', 'sortSelect', 'filterSelect'].forEach((id) => { this.$(id).oninput = () => this.renderInventory(); });
    document.querySelectorAll('[data-sell]').forEach((button) => { button.onclick = () => this.sell(button.dataset.sell); });
    this.$('salvageButton').onclick = () => this.salvage();
    this.$('fusionButton').onclick = () => this.app.fusion.fuse();
    this.$('saveButton').onclick = () => { this.app.save.auto(); this.log('保存しました。'); };
  }
  render() { this.renderEnemy(); this.renderEquipment(); this.renderInventory(); this.renderStats(); this.renderWallet(); }
  renderWallet() { this.$('goldText').textContent = this.app.player.gold; this.$('materialText').textContent = this.app.player.materials; }
  renderEnemy() {
    const enemy = this.app.battle.enemy;
    this.$('enemyAvatar').textContent = enemy.emoji;
    this.$('enemyName').textContent = enemy.name;
    this.$('enemyLevel').textContent = `Lv ${enemy.level}`;
    this.$('progressText').textContent = `Wave ${this.app.battle.wave}`;
    this.$('enemyHpBar').style.width = `${clamp(enemy.hp / enemy.maxHp * 100, 0, 100)}%`;
    this.$('enemyHpText').textContent = `${Math.max(0, enemy.hp)} / ${enemy.maxHp} HP`;
  }
  card(item) {
    return `<div class="item-title" style="color:${item.color}">${item.name}</div>
      <div class="item-meta"><span>${item.rarity} Lv${item.level}</span><span>${SLOTS[item.slot]}</span></div>
      <div class="item-meta"><span>攻 ${item.stats.attack ?? 0}</span><span>価 ${item.value}G</span></div>`;
  }
  renderEquipment() {
    this.$('equipmentGrid').innerHTML = Object.entries(SLOTS).map(([slot, label]) => {
      const item = this.app.player.equipment[slot];
      return `<div class="equipment-card ${item ? `rarity-${item.rarity}` : ''}" data-eq="${slot}">
        <div class="slot-label">${label}</div>${item ? this.card(item) : '<p class="muted">未装備</p>'}</div>`;
    }).join('');
    document.querySelectorAll('[data-eq]').forEach((element) => {
      element.onclick = () => this.detail(this.app.player.equipment[element.dataset.eq]);
    });
  }
  renderInventory() {
    const query = this.$('searchInput').value.toLowerCase();
    const sort = this.$('sortSelect').value;
    const filter = this.$('filterSelect').value;
    if (this.$('filterSelect').options.length === 1) {
      this.app.data.rarity.forEach((rarity) => this.$('filterSelect').add(new Option(rarity.name, rarity.name)));
    }
    let items = [...this.app.inventory.items].filter((item) =>
      (filter === 'all' || item.rarity === filter) && item.name.toLowerCase().includes(query)
    );
    items.sort((a, b) => sort === 'rarity' ? b.rank - a.rank :
      sort === 'attack' ? (b.stats.attack ?? 0) - (a.stats.attack ?? 0) :
      sort === 'value' ? b.value - a.value : b.createdAt - a.createdAt);
    this.$('inventoryCount').textContent = `${this.app.inventory.items.length} / ${this.app.inventory.max}`;
    this.$('inventoryList').innerHTML = items.map((item) =>
      `<article class="item-card rarity-${item.rarity} ${this.app.inventory.selected.has(item.id) ? 'selected' : ''}" data-id="${item.id}" style="border-color:${item.color}66">${this.card(item)}</article>`
    ).join('');
    document.querySelectorAll('[data-id]').forEach((element) => {
      element.onclick = () => {
        const id = element.dataset.id;
        const item = this.app.inventory.items.find((entry) => entry.id === id);
        this.app.inventory.selected.has(id) ? this.app.inventory.selected.delete(id) : this.app.inventory.selected.add(id);
        this.detail(item);
        this.renderInventory();
      };
    });
  }
  renderStats() {
    const stats = this.app.player.stats();
    this.$('statsGrid').innerHTML = Object.entries(STAT_LABELS)
      .filter(([key]) => stats[key] != null)
      .map(([key, label]) => `<div class="stat"><span>${label}</span><b>${stats[key]}</b></div>`).join('');
  }
  detail(item) {
    if (!item) return;
    const equipped = this.app.player.equipment[item.slot];
    const diffs = Object.entries(item.stats).map(([key, value]) => {
      const diff = value - (equipped?.stats[key] ?? 0);
      return `${STAT_LABELS[key] ?? key}: ${value} <span class="${diff >= 0 ? 'diff-up' : 'diff-down'}">(${formatSigned(diff)})</span>`;
    }).join('<br>');
    this.$('selectedHint').textContent = item.name;
    this.$('itemDetail').innerHTML = `<h3 style="color:${item.color}">${item.name}</h3>
      <p>${item.rarity} / ${SLOTS[item.slot]} / 売値 ${item.value}G</p>${diffs}<hr>
      <button id="equipNow" class="primary-action">装備</button><button id="sellNow" class="ghost-button">売却</button>`;
    this.$('equipNow').onclick = () => {
      const previous = this.app.player.equip(item);
      this.app.inventory.remove([item.id]);
      if (previous) this.app.inventory.add([previous]);
      this.app.save.auto();
      this.render();
    };
    this.$('sellNow').onclick = () => { this.app.player.gold += item.value; this.app.inventory.remove([item.id]); this.render(); };
  }
  log(text) { this.$('dropLog').insertAdjacentHTML('afterbegin', `<div class="log-entry">${text}</div>`); }
  logDrop(item) {
    this.log(`<b style="color:${item.color}">${item.rarity}</b> ${item.name} がドロップ`);
    if (item.rank >= 2) this.effect(item.rarity, item.rank >= 6);
  }
  sell(maxRarity) {
    const rank = this.app.data.rarity.find((rarity) => rarity.name === maxRarity).rank;
    const ids = [];
    this.app.inventory.items.forEach((item) => { if (item.rank <= rank) { this.app.player.gold += item.value; ids.push(item.id); } });
    this.app.inventory.remove(ids);
    this.render();
    this.log(`${ids.length}個売却しました。`);
  }
  salvage() {
    const ids = [...this.app.inventory.selected];
    ids.forEach((id) => {
      const item = this.app.inventory.items.find((entry) => entry.id === id);
      if (item) this.app.player.materials += item.material;
    });
    this.app.inventory.remove(ids);
    this.render();
    this.log(`${ids.length}個分解しました。`);
  }
  effect(text, big) { this.app.effects.burst(text, big); }
}

class App {
  async start() {
    this.data = new DataStore();
    await this.data.load();
    this.player = new Player();
    this.inventory = new Inventory(this.data.dropTable.maxInventory);
    this.generator = new ItemGenerator(this.data);
    this.drop = new DropManager(this);
    this.battle = new Battle(this);
    this.fusion = new FusionManager(this);
    this.craft = new CraftManager(this);
    this.save = new SaveManager(this);
    this.effects = new EffectManager(document.getElementById('effectLayer'));
    this.sound = new SoundManager();
    this.ui = new UIManager(this);
    this.save.load();
    this.ui.bind();
    this.ui.render();
    this.ui.log('シミュレーター起動。攻撃してドロップを厳選しましょう。');
  }
}

new App().start();
