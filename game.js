/* game.js — Stable full rewrite (fixes selectedHand / numeric bugs)
   - toNum() normalization everywhere
   - equip flow: choose up to 2 unlocked skills, must confirm to proceed
   - clearHandSelection() implemented and used consistently
   - robust playerAttack / enemyTurn logic
   - preserves FX (attack/hit/destroy/damage/flash)
*/

const MAX_VALUE = 4;
const STORAGE_KEY = 'fd_unlocked_skills_v1';

const SKILL_POOL = [
  { id:'power',    type:'passive', name:'💥 パワーアップ', desc:'攻撃 +1' },
  { id:'guard',    type:'passive', name:'🛡 ガード',       desc:'敵攻撃 -1' },
  { id:'berserk',  type:'passive', name:'⚡ バーサーク',   desc:'自分の手が4のとき攻撃 +2' },
  { id:'regen',    type:'passive', name:'💚 リジェネ',     desc:'敵ターン後にランダムな手 +1' },
  { id:'double',   type:'active',  name:'⛏ ダブルストライク', desc:'次の攻撃が2回分（1回）' },
  { id:'heal',     type:'active',  name:'✨ ヒール',       desc:'味方の手を +2（選択）' },
  { id:'pierce',   type:'passive', name:'🔩 ピアス',      desc:'破壊閾値に影響（将来拡張）' }
];

const gameState = {
  stage: 1,
  isBoss: false,
  player: { left: 1, right: 1 },
  enemy: { left: 1, right: 1 },
  playerTurn: true,
  unlockedSkills: [],
  equippedSkills: [],
  pendingActiveUse: null,
  doubleActive: false
};

let selectedHand = null;
let equipTemp = [];

/* ---------- DOM ---------- */
const stageInfo = document.getElementById('stageInfo');
const skillInfo = document.getElementById('skillInfo') || (() => { const el=document.createElement('div'); el.id='skillInfo'; document.querySelector('.container').prepend(el); return el; })();
const messageArea = document.getElementById('message');
const skillSelectArea = document.getElementById('skillSelectArea');
const equippedList = document.getElementById('equippedList');
const unlockedList = document.getElementById('unlockedList');
const flashLayer = document.getElementById('flashLayer');

const hands = {
  playerLeft: document.getElementById('player-left'),
  playerRight: document.getElementById('player-right'),
  enemyLeft: document.getElementById('enemy-left'),
  enemyRight: document.getElementById('enemy-right')
};

const bars = {
  playerLeft: document.getElementById('player-left-bar'),
  playerRight: document.getElementById('player-right-bar'),
  enemyLeft: document.getElementById('enemy-left-bar'),
  enemyRight: document.getElementById('enemy-right-bar')
};

/* ---------- helpers ---------- */
const rand = (min,max) => Math.floor(Math.random()*(max-min+1))+min;

function toNum(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function saveUnlocked(){
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(gameState.unlockedSkills)); } catch(e){}
}
function loadUnlocked(){
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if(s){
      const arr = JSON.parse(s);
      if(Array.isArray(arr)) return arr;
    }
  } catch(e){}
  return null;
}

/* ---------- initial unlocks ---------- */
function seedInitialUnlocks(){
  const base = ['power','guard'];
  gameState.unlockedSkills = base.slice();
  saveUnlocked();
}

/* ---------- init ---------- */
function initGame(){
  const loaded = loadUnlocked();
  if(loaded && loaded.length>0) gameState.unlockedSkills = loaded;
  else seedInitialUnlocks();
  startBattle();
}

/* ---------- startBattle ---------- */
function startBattle(){
  // reset selection / flags
  equipTemp = [];
  selectedHand = null;
  gameState.pendingActiveUse = null;
  gameState.doubleActive = false;
  gameState.equippedSkills = [];
  gameState.playerTurn = true;

  // player full restore for each stage
  gameState.player.left = 1;
  gameState.player.right = 1;

  gameState.isBoss = (gameState.stage % 3 === 0);
  document.body.classList.toggle('boss', gameState.isBoss);

  const base = Math.min(4, 1 + Math.floor(gameState.stage / 2));
  const min = gameState.isBoss ? base : 1;
  const max = gameState.isBoss ? base + 1 : base;

  gameState.enemy.left = toNum(rand(min, max));
  gameState.enemy.right = toNum(rand(min, max));

  updateUI();
  showEquipSelection();
  renderUnlockedList();
}

/* ---------- equip selection ---------- */
function showEquipSelection(){
  skillSelectArea.innerHTML = '';
  messageArea.textContent = '装備スキルを最大2つ選んで「確定」してください';
  const unlocked = gameState.unlockedSkills.slice();
  if(unlocked.length === 0){
    skillSelectArea.innerHTML = '<div>アンロック済みスキルがありません</div><button id="equipConfirm">確定</button>';
    document.getElementById('equipConfirm').onclick = () => commitEquips();
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'skill-choices';

  unlocked.forEach(id => {
    const def = SKILL_POOL.find(s=>s.id===id);
    if(!def) return;
    const btn = document.createElement('button');
    btn.className = 'skill-btn';
    btn.dataset.id = id;
    btn.innerHTML = `<div style="font-weight:700">${def.name}</div><small style="opacity:.9">${def.desc}</small>`;
    btn.onclick = () => {
      const idx = equipTemp.indexOf(id);
      if(idx === -1){
        if(equipTemp.length >= 2){
          messageArea.textContent = '最大2つまで装備できます';
          setTimeout(()=> messageArea.textContent = '装備スキルを最大2つ選んで「確定」してください', 900);
          return;
        }
        equipTemp.push(id);
        btn.classList.add('chosen');
      } else {
        equipTemp.splice(idx,1);
        btn.classList.remove('chosen');
      }
    };
    wrap.appendChild(btn);
  });

  const confirm = document.createElement('button');
  confirm.textContent = '確定';
  confirm.style.marginLeft = '8px';
  confirm.onclick = () => commitEquips();

  skillSelectArea.appendChild(wrap);
  skillSelectArea.appendChild(confirm);
}

function commitEquips(){
  gameState.equippedSkills = equipTemp.map(id => {
    const d = SKILL_POOL.find(s=>s.id===id);
    return { id:d.id, type:d.type, name:d.name, desc:d.desc, used:false };
  });
  equipTemp = [];
  skillSelectArea.innerHTML = '';
  messageArea.textContent = '';
  renderEquipped();
  renderUnlockedList();
  skillInfo.textContent = 'Equipped: ' + (gameState.equippedSkills.map(s=>s.name).join(', ') || '—');
}

/* ---------- render lists ---------- */
function renderEquipped(){
  equippedList.innerHTML = '';
  if(!gameState.equippedSkills || gameState.equippedSkills.length === 0){
    equippedList.textContent = '(None)';
    return;
  }
  gameState.equippedSkills.forEach((s, idx) => {
    const card = document.createElement('div');
    card.className = 'skill-card';
    if(s.type === 'passive'){
      card.innerHTML = `<div class="skill-passive">${s.name}<div style="font-size:12px;opacity:.8">${s.desc}</div></div>`;
    } else {
      const btn = document.createElement('button');
      btn.textContent = s.name;
      btn.disabled = s.used;
      if(s.used) btn.classList.add('used');
      btn.onclick = () => {
        if(s.used) return;
        if(s.id === 'double'){
          s.used = true;
          gameState.doubleActive = true;
          messageArea.textContent = 'ダブルストライクを有効化しました（次の攻撃が2回分）';
          renderEquipped();
        } else if(s.id === 'heal'){
          gameState.pendingActiveUse = { id:'heal', idx };
          messageArea.textContent = 'ヒール使用：回復する味方の手を選んでください';
        }
      };
      const div = document.createElement('div');
      div.className = 'skill-active';
      div.appendChild(btn);
      card.appendChild(div);
    }
    equippedList.appendChild(card);
  });
}

function renderUnlockedList(){
  unlockedList.innerHTML = '';
  if(!gameState.unlockedSkills || gameState.unlockedSkills.length === 0){
    unlockedList.textContent = '(No unlocked skills)';
    return;
  }
  gameState.unlockedSkills.forEach(id => {
    const def = SKILL_POOL.find(s=>s.id===id);
    if(!def) return;
    const card = document.createElement('div');
    card.className = 'skill-card';
    card.innerHTML = `<div style="font-weight:700">${def.name}</div><div style="font-size:12px;opacity:.85">${def.desc}</div>`;
    unlockedList.appendChild(card);
  });
}

/* ---------- UI update ---------- */
function updateUI(){
  stageInfo.textContent = `Stage ${gameState.stage} ${gameState.isBoss ? 'BOSS' : ''}`;
  skillInfo.textContent = gameState.equippedSkills && gameState.equippedSkills.length ? 'Equipped: ' + gameState.equippedSkills.map(s=>s.name).join(', ') : 'Equipped: —';
  updateHand('playerLeft', gameState.player.left);
  updateHand('playerRight', gameState.player.right);
  updateHand('enemyLeft', gameState.enemy.left);
  updateHand('enemyRight', gameState.enemy.right);
}

function updateHand(key, value){
  const el = hands[key];
  const bar = bars[key];
  const v = toNum(value);
  el.textContent = v;
  el.classList.toggle('zero', v === 0);
  if(bar) bar.style.width = (v / MAX_VALUE) * 100 + '%';
}

/* ---------- FX ---------- */
function flashScreen(duration = 0.18){
  flashLayer.classList.add('flash');
  setTimeout(()=> flashLayer.classList.remove('flash'), Math.max(80, duration*1000));
}
function showDamage(targetEl, val, color='#ff6b6b'){
  const d = document.createElement('div');
  d.className = 'damage';
  d.textContent = `+${val}`;
  d.style.color = color;
  targetEl.appendChild(d);
  setTimeout(()=> d.remove(), 820);
}
function animateAttack(attackerEl, targetEl){
  attackerEl.classList.add('attack'); targetEl.classList.add('hit');
  setTimeout(()=> { attackerEl.classList.remove('attack'); targetEl.classList.remove('hit'); }, 320);
}
function animateDestroy(targetEl){
  targetEl.classList.add('destroy'); setTimeout(()=> targetEl.classList.remove('destroy'), 500);
}

/* ---------- passives ---------- */
function playerAttackBonus(handKey){
  let bonus = 0;
  (gameState.equippedSkills || []).forEach(s => {
    if(s.type !== 'passive') return;
    if(s.id === 'power') bonus += 1;
    if(s.id === 'berserk' && toNum(gameState.player[handKey]) === 4) bonus += 2;
  });
  return bonus;
}
function modifyEnemyAttackValue(baseVal){
  let val = toNum(baseVal);
  (gameState.equippedSkills || []).forEach(s => {
    if(s.type !== 'passive') return;
    if(s.id === 'guard') val = Math.max(0, val - 1);
  });
  return val;
}

/* ---------- selection helpers ---------- */
function clearHandSelection(){
  selectedHand = null;
  hands.playerLeft.classList.remove('selected');
  hands.playerRight.classList.remove('selected');
}

/* ---------- player attack (robust) ---------- */
function playerAttack(targetSide){
  // guard: if equip selection UI is open, block actions
  if(skillSelectArea && skillSelectArea.children.length > 0) {
    messageArea.textContent = 'まず装備を確定してください';
    return;
  }

  if(!gameState.playerTurn) return;
  if(!selectedHand) { messageArea.textContent = '攻撃する手を選んでください'; return; }

  if(gameState.pendingActiveUse && gameState.pendingActiveUse.id === 'heal'){
    messageArea.textContent = 'ヒール使用中：味方の手を選んでください';
    return;
  }

  const attackerKey = selectedHand; // 'left' or 'right'
  const attackerEl = hands[attackerKey === 'left' ? 'playerLeft' : 'playerRight'];
  const targetEl = hands[targetSide === 'left' ? 'enemyLeft' : 'enemyRight'];

  animateAttack(attackerEl, targetEl);

  let baseAtk = toNum(gameState.player[attackerKey]);
  baseAtk += playerAttackBonus(attackerKey);

  // handle double active (active skill)
  let isDouble = false;
  if(gameState.doubleActive){
    isDouble = true;
    gameState.doubleActive = false;
    const di = (gameState.equippedSkills || []).findIndex(x => x.id === 'double' && !x.used);
    if(di !== -1){ gameState.equippedSkills[di].used = true; renderEquipped(); }
  }

  showDamage(targetEl, baseAtk);

  let curEnemy = toNum(gameState.enemy[targetSide]);
  let added = isDouble ? baseAtk * 2 : baseAtk;
  let newVal = curEnemy + added;
  if(!Number.isFinite(newVal)) newVal = 0;

  if(newVal >= 5){
    newVal = 0;
    animateDestroy(targetEl);
  } else {
    if(newVal > MAX_VALUE) newVal = MAX_VALUE;
  }

  gameState.enemy[targetSide] = newVal;

  clearHandSelection();
  gameState.playerTurn = false;
  updateUI();
  flashScreen();

  if(!checkWinLose()) setTimeout(enemyTurn, 650);
}

/* ---------- enemy turn ---------- */
function enemyTurn(){
  const alivePlayer = ['left','right'].filter(s => toNum(gameState.player[s]) > 0);
  const aliveEnemy  = ['left','right'].filter(s => toNum(gameState.enemy[s]) > 0);

  if(alivePlayer.length === 0 || aliveEnemy.length === 0) return;

  const from = aliveEnemy[rand(0, aliveEnemy.length-1)];
  const to = alivePlayer[rand(0, alivePlayer.length-1)];

  const attackerEl = hands[from === 'left' ? 'enemyLeft' : 'enemyRight'];
  const targetEl = hands[to === 'left' ? 'playerLeft' : 'playerRight'];

  animateAttack(attackerEl, targetEl);

  let attackValue = toNum(gameState.enemy[from]);
  attackValue = modifyEnemyAttackValue(attackValue);

  showDamage(targetEl, attackValue, '#ffb86b');

  let curPlayer = toNum(gameState.player[to]);
  let newVal = curPlayer + attackValue;
  if(!Number.isFinite(newVal)) newVal = 0;

  if(newVal >= 5){
    newVal = 0;
    animateDestroy(targetEl);
  } else {
    if(newVal > MAX_VALUE) newVal = MAX_VALUE;
  }

  gameState.player[to] = newVal;

  // regen passive
  if((gameState.equippedSkills || []).some(s => s.id === 'regen' && s.type === 'passive')){
    const candidates = ['left','right'].filter(k => toNum(gameState.player[k]) > 0 && toNum(gameState.player[k]) < MAX_VALUE);
    if(candidates.length > 0){
      const r = candidates[rand(0, candidates.length-1)];
      gameState.player[r] = Math.min(MAX_VALUE, toNum(gameState.player[r]) + 1);
      const el = hands[r === 'left' ? 'playerLeft' : 'playerRight'];
      const plus = document.createElement('div'); plus.className='damage'; plus.style.color='#7be38a'; plus.textContent='+1'; el.appendChild(plus);
      setTimeout(()=> plus.remove(), 900);
    }
  }

  gameState.playerTurn = true;
  updateUI();
  flashScreen();
  checkWinLose();
}

/* ---------- pending active (heal) ---------- */
function applyPendingActiveOnPlayer(side){
  if(!gameState.pendingActiveUse) return;
  const pending = gameState.pendingActiveUse;
  const skillObj = gameState.equippedSkills[pending.idx];
  if(!skillObj || skillObj.used){ gameState.pendingActiveUse = null; messageArea.textContent = 'そのスキルは使用できません'; return; }

  if(pending.id === 'heal'){
    const cur = toNum(gameState.player[side]);
    gameState.player[side] = Math.min(MAX_VALUE, cur + 2);
    skillObj.used = true;
    messageArea.textContent = `${skillObj.name} を ${side} に使用しました`;
    const el = hands[side === 'left' ? 'playerLeft' : 'playerRight'];
    const plus = document.createElement('div'); plus.className='damage'; plus.style.color='#7be38a'; plus.textContent='+2'; el.appendChild(plus);
    setTimeout(()=> plus.remove(), 900);
    gameState.pendingActiveUse = null;
    updateUI();
    renderEquipped();
  }
}

/* ---------- check win/lose & reward ---------- */
function checkWinLose(){
  const playerDead = toNum(gameState.player.left) === 0 && toNum(gameState.player.right) === 0;
  const enemyDead = toNum(gameState.enemy.left) === 0 && toNum(gameState.enemy.right) === 0;

  if(enemyDead){
    messageArea.textContent = 'Victory! スキル報酬を獲得';
    setTimeout(()=> showRewardSelection(), 600);
    return true;
  }
  if(playerDead){
    messageArea.textContent = 'Game Over';
    return true;
  }
  return false;
}

/* ---------- reward selection ---------- */
function showRewardSelection(){
  const notUnlocked = SKILL_POOL.filter(s => !gameState.unlockedSkills.includes(s.id));
  skillSelectArea.innerHTML = '';
  if(notUnlocked.length === 0){
    skillSelectArea.innerHTML = '<div>全てのスキルをアンロック済みです。次のステージへ進みます。</div><button id="contBtn">続ける</button>';
    document.getElementById('contBtn').onclick = () => {
      gameState.stage++;
      saveUnlocked();
      skillSelectArea.innerHTML = '';
      startBattle();
    };
    return;
  }

  const choices = notUnlocked.sort(()=>0.5 - Math.random()).slice(0,3);
  messageArea.textContent = '報酬スキルを1つ選んでください（永久アンロック）';
  const wrap = document.createElement('div'); wrap.className = 'skill-choices';

  choices.forEach(s => {
    const btn = document.createElement('button');
    btn.className = 'skill-btn';
    btn.innerHTML = `<div style="font-weight:700">${s.name}</div><small style="opacity:.9">${s.desc}</small>`;
    btn.onclick = () => {
      gameState.unlockedSkills.push(s.id);
      saveUnlocked();
      messageArea.textContent = `${s.name} をアンロックしました！`;
      flashScreen(.14);
      renderUnlockedList();
      skillSelectArea.innerHTML = '';
      setTimeout(()=> {
        gameState.stage++;
        startBattle();
      }, 700);
    };
    wrap.appendChild(btn);
  });

  skillSelectArea.appendChild(wrap);
}

/* ---------- click handlers ---------- */
function selectHand(side){
  // if heal pending, apply to own side
  if(gameState.pendingActiveUse && gameState.pendingActiveUse.id === 'heal'){
    applyPendingActiveOnPlayer(side);
    return;
  }

  // if equip UI open, block selection
  if(skillSelectArea && skillSelectArea.children.length > 0){
    messageArea.textContent = 'まず装備を確定してください';
    return;
  }

  if(!gameState.playerTurn) return;
  if(toNum(gameState.player[side]) === 0) return;

  selectedHand = side;
  hands.playerLeft.classList.toggle('selected', side === 'left');
  hands.playerRight.classList.toggle('selected', side === 'right');

  messageArea.textContent = '敵の手を選んで攻撃してください';
}

function clickEnemyHand(side){
  if(skillSelectArea && skillSelectArea.children.length > 0){
    messageArea.textContent = 'まず装備を確定してください';
    return;
  }
  if(!gameState.playerTurn) return;
  if(!selectedHand){ messageArea.textContent = '攻撃する手を選んでください'; return; }
  if(toNum(gameState.enemy[side]) === 0){ messageArea.textContent = 'その敵の手は既に0です'; return; }

  playerAttack(side);
}

/* attach handlers once */
hands.playerLeft.onclick = () => selectHand('left');
hands.playerRight.onclick = () => selectHand('right');
hands.enemyLeft.onclick = () => clickEnemyHand('left');
hands.enemyRight.onclick = () => clickEnemyHand('right');

/* ---------- start ---------- */
initGame();
