const gameState = {
  stage: 1,
  isBoss: false,
  player: { left: 1, right: 1 },
  enemy: { left: 1, right: 1 },
  reviveUsed: false,
  bonusAttack: 0,
  nextBattleBuff: 0,
  passiveGrowth: false
};

let selectedHand = null;

const stageInfo = document.getElementById("stageInfo");
const messageDiv = document.getElementById("message");
const upgradeArea = document.getElementById("upgradeArea");

const hands = {
  playerLeft: document.getElementById("player-left"),
  playerRight: document.getElementById("player-right"),
  enemyLeft: document.getElementById("enemy-left"),
  enemyRight: document.getElementById("enemy-right")
};

const rand = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

function initGame() {
  const saved = localStorage.getItem("fingerDungeonStage");
  if (saved) gameState.stage = parseInt(saved);
  startBattle();
}

function startBattle() {
  selectedHand = null;
  upgradeArea.innerHTML = "";
  messageDiv.textContent = "";

  gameState.isBoss = gameState.stage % 3 === 0;

  const base = Math.min(4, 1 + Math.floor(gameState.stage / 2));
  const enemyMin = gameState.isBoss ? base : 1;
  const enemyMax = gameState.isBoss ? base + 1 : base;

  gameState.enemy.left = rand(enemyMin, enemyMax);
  gameState.enemy.right = rand(enemyMin, enemyMax);

  if (gameState.nextBattleBuff > 0) {
    gameState.player.left += gameState.nextBattleBuff;
    gameState.player.right += gameState.nextBattleBuff;
    gameState.nextBattleBuff = 0;
  }

  updateUI();
}

function updateUI() {
  stageInfo.textContent = `Stage ${gameState.stage} ${gameState.isBoss ? "BOSS" : ""}`;
  document.body.classList.toggle("boss", gameState.isBoss);

  updateHand(hands.playerLeft, gameState.player.left);
  updateHand(hands.playerRight, gameState.player.right);
  updateHand(hands.enemyLeft, gameState.enemy.left);
  updateHand(hands.enemyRight, gameState.enemy.right);
}

function updateHand(element, value) {
  element.textContent = value;
  element.classList.remove("zero");
  if (value === 0) element.classList.add("zero");
}

function playerAttack(targetSide) {
  if (!selectedHand) return;

  const attackValue = gameState.player[selectedHand] + gameState.bonusAttack;
  gameState.enemy[targetSide] =
    (gameState.enemy[targetSide] + attackValue) % 5;

  selectedHand = null;

  if (gameState.passiveGrowth) {
    const side = Math.random() < 0.5 ? "left" : "right";
    if (gameState.player[side] !== 0)
      gameState.player[side] = Math.min(4, gameState.player[side] + 1);
  }

  updateUI();
  if (!checkWinLose()) setTimeout(enemyTurn, 500);
}

function enemyTurn() {
  const playerSides = ["left", "right"].filter(
    s => gameState.player[s] > 0
  );
  const enemySides = ["left", "right"].filter(
    s => gameState.enemy[s] > 0
  );

  if (playerSides.length === 0 || enemySides.length === 0) return;

  let from, to;

  if (gameState.isBoss) {
    to = playerSides.reduce((a, b) =>
      gameState.player[a] > gameState.player[b] ? a : b
    );
    from = enemySides[0];
  } else {
    from = enemySides[rand(0, enemySides.length - 1)];
    to = playerSides[rand(0, playerSides.length - 1)];
  }

  gameState.player[to] =
    (gameState.player[to] + gameState.enemy[from]) % 5;

  updateUI();
  checkWinLose();
}

function checkWinLose() {
  const playerDead =
    gameState.player.left === 0 &&
    gameState.player.right === 0;
  const enemyDead =
    gameState.enemy.left === 0 &&
    gameState.enemy.right === 0;

  if (enemyDead) {
    messageDiv.textContent = "Victory!";
    showUpgrades();
    return true;
  }

  if (playerDead) {
    if (!gameState.reviveUsed) {
      gameState.player.left = 1;
      gameState.reviveUsed = true;
      messageDiv.textContent = "Revived!";
      updateUI();
      return false;
    }
    messageDiv.textContent = "Game Over";
    localStorage.setItem("fingerDungeonStage", gameState.stage);
    return true;
  }
  return false;
}

function showUpgrades() {
  const upgrades = [
    {
      text: "ランダムな手+1",
      effect: () => {
        const side = Math.random() < 0.5 ? "left" : "right";
        gameState.player[side]++;
      }
    },
    {
      text: "両手+1（次戦闘）",
      effect: () => (gameState.nextBattleBuff = 1)
    },
    {
      text: "攻撃+1",
      effect: () => (gameState.bonusAttack += 1)
    },
    {
      text: "1回復活",
      effect: () => (gameState.reviveUsed = false)
    },
    {
      text: "毎ターン終了時+1",
      effect: () => (gameState.passiveGrowth = true)
    }
  ];

  upgradeArea.innerHTML = "";
  const choices = upgrades.sort(() => 0.5 - Math.random()).slice(0, 3);

  choices.forEach(upg => {
    const btn = document.createElement("button");
    btn.textContent = upg.text;
    btn.className = "upgradeBtn";
    btn.onclick = () => {
      upg.effect();
      gameState.stage++;
      localStorage.setItem("fingerDungeonStage", gameState.stage);
      startBattle();
    };
    upgradeArea.appendChild(btn);
  });
}

hands.playerLeft.onclick = () => selectHand("left");
hands.playerRight.onclick = () => selectHand("right");
hands.enemyLeft.onclick = () => playerAttack("left");
hands.enemyRight.onclick = () => playerAttack("right");

function selectHand(side) {
  if (gameState.player[side] === 0) return;
  selectedHand = side;
}

initGame();