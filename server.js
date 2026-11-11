const express = require("express");
const http = require("http");
const path = require("path");
const os = require("os");
const { Server } = require("socket.io");
const {
  CATASTROPHES,
  PROFESSIONS,
  CAPITAL_ASSETS,
  ECONOMIC_SKILLS,
  ECONOMIC_RISKS,
  SPECIAL_ACTIONS,
  ROUND_EVENTS,
  shuffleArray
} = require("./gameData");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Хранилище комнат в памяти
const rooms = new Map();

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips.length > 0 ? ips : ["localhost"];
}

function generateRoomCode() {
  const digits = "0123456789";
  let code = "";
  do {
    code = "";
    for (let i = 0; i < 4; i++) {
      code += digits[Math.floor(Math.random() * digits.length)];
    }
  } while (rooms.has(code));
  return code;
}

function calculateBunkerSlots(playerCount) {
  // По классике «Бункера» спастись может примерно половина участников (округление вверх)
  return Math.max(1, Math.ceil(playerCount / 2));
}

function buildPlayerHand(prof, asset, skill, risk, action) {
  return {
    profession: {
      id: "profession",
      categoryLabel: "ЭКОНОМИЧЕСКАЯ ПРОФЕССИЯ",
      icon: "briefcase",
      title: prof.title,
      subtitle: `${prof.category} • ${prof.experience}`,
      badge: prof.salaryPreCrisis,
      effect: prof.effect,
      concept: prof.lessonConcept,
      revealed: false
    },
    capital: {
      id: "capital",
      categoryLabel: "КАПИТАЛ И АКТИВЫ",
      icon: "coins",
      title: asset.title,
      subtitle: `Ликвидность: ${asset.liquidity}`,
      badge: "АКТИВ / БАЛАНС",
      effect: asset.effect,
      concept: asset.concept,
      revealed: false
    },
    skill: {
      id: "skill",
      categoryLabel: "ЭКОНОМИЧЕСКИЙ НАВЫК",
      icon: "trending-up",
      title: skill.title,
      subtitle: "Прикладная компетенция",
      badge: "СИЛЬНАЯ СТОРОНА",
      effect: skill.effect,
      concept: skill.concept,
      revealed: false
    },
    risk: {
      id: "risk",
      categoryLabel: "ЭКОНОМИЧЕСКИЙ РИСК / ФАКТОР",
      icon: "alert-triangle",
      title: risk.title,
      subtitle: `Уровень угрозы: ${risk.severity}`,
      badge: risk.severity,
      effect: risk.effect,
      concept: risk.concept,
      revealed: false,
      mitigated: false
    },
    special: {
      id: "special",
      categoryLabel: "СПЕЦКАРТА ИНСАЙДЕРА",
      icon: "zap",
      title: action.title,
      subtitle: action.code,
      badge: "ОДНОРАЗОВОЕ ДЕЙСТВИЕ",
      effect: action.effect,
      concept: action.concept,
      revealed: false,
      used: false
    }
  };
}

function dealCardsToRoom(room) {
  const count = room.players.length;
  const profDeck = shuffleArray(PROFESSIONS);
  const assetDeck = shuffleArray(CAPITAL_ASSETS);
  const skillDeck = shuffleArray(ECONOMIC_SKILLS);
  const riskDeck = shuffleArray(ECONOMIC_RISKS);
  const actionDeck = shuffleArray(SPECIAL_ACTIONS);

  // Сохраняем остаток колод в резерве комнаты для спецкарт обмена
  room.reserveDecks = {
    professions: profDeck.slice(count),
    assets: assetDeck.slice(count),
    skills: skillDeck.slice(count),
    risks: riskDeck.slice(count)
  };

  room.players.forEach((player, idx) => {
    const prof = profDeck[idx % profDeck.length];
    const asset = assetDeck[idx % assetDeck.length];
    const skill = skillDeck[idx % skillDeck.length];
    const risk = riskDeck[idx % riskDeck.length];
    const action = actionDeck[idx % actionDeck.length];

    player.cards = buildPlayerHand(prof, asset, skill, risk, action);
    player.alive = true;
    player.votesReceived = 0;
    player.hasVoted = false;
    player.votedFor = null;
    player.voteWeight = 1;
    player.voteShield = 0;
  });
}

function computeEconomicAnalytics(room) {
  // Считаем сводный рейтинг выживаемости бункера на основе открытых карт и выживших игроков
  const activePlayers = room.players.filter((p) => p.alive);
  let revealedCount = 0;
  let totalCards = activePlayers.length * 5;
  let productionScore = 45;
  let financeStability = 50;
  let resourceSecurity = 45;
  const activeConcepts = [];

  activePlayers.forEach((p) => {
    if (!p.cards) return;
    Object.values(p.cards).forEach((card) => {
      if (card.revealed) {
        revealedCount++;
        if (card.concept && activeConcepts.length < 8) {
          activeConcepts.push({
            playerName: p.name,
            cardTitle: card.title,
            concept: card.concept
          });
        }
        if (card.id === "profession") {
          productionScore += 8;
          financeStability += 6;
        }
        if (card.id === "capital") {
          if (card.title.includes("обесценившихся") || card.title.includes("долг")) {
            financeStability -= 5;
          } else {
            resourceSecurity += 10;
          }
        }
        if (card.id === "skill") {
          productionScore += 7;
          resourceSecurity += 6;
        }
        if (card.id === "risk" && !card.mitigated) {
          if (card.badge.includes("Высокий")) {
            financeStability -= 8;
            resourceSecurity -= 6;
          } else {
            financeStability -= 4;
          }
        }
      }
    });
  });

  return {
    transparencyPercent: totalCards > 0 ? Math.round((revealedCount / totalCards) * 100) : 0,
    productionScore: Math.min(100, Math.max(15, productionScore)),
    financeStability: Math.min(100, Math.max(15, financeStability)),
    resourceSecurity: Math.min(100, Math.max(15, resourceSecurity)),
    activeConcepts
  };
}

function serializeRoomForPlayer(room, viewerToken) {
  const analytics = computeEconomicAnalytics(room);
  const currentRoundEvent =
    ROUND_EVENTS[Math.min(room.round - 1, ROUND_EVENTS.length - 1)] || ROUND_EVENTS[0];

  return {
    code: room.code,
    status: room.status, // 'lobby' | 'playing' | 'voting' | 'finished'
    round: room.round,
    bunkerSlots: room.bunkerSlots,
    catastrophe: room.catastrophe,
    roundEvent: currentRoundEvent,
    hostToken: room.hostToken,
    logs: room.logs.slice(-25),
    analytics,
    votingState: room.votingState,
    players: room.players.map((p) => {
      const isMe = p.token === viewerToken;
      const serializedCards = {};
      if (p.cards) {
        for (const [key, card] of Object.entries(p.cards)) {
          if (isMe || card.revealed || room.status === "finished") {
            serializedCards[key] = { ...card };
          } else {
            // Скрытая карта для остальных игроков (видна только категория)
            serializedCards[key] = {
              id: card.id,
              categoryLabel: card.categoryLabel,
              icon: card.icon,
              revealed: false,
              hidden: true
            };
          }
        }
      }
      return {
        id: p.id,
        token: isMe ? p.token : undefined,
        isMe,
        isHost: p.token === room.hostToken,
        name: p.name,
        roleTag: p.roleTag,
        online: p.online,
        alive: p.alive,
        votesReceived: p.votesReceived,
        hasVoted: p.hasVoted,
        voteWeight: p.voteWeight,
        voteShield: p.voteShield,
        cards: p.cards ? serializedCards : null
      };
    })
  };
}

function broadcastRoom(room) {
  for (const player of room.players) {
    if (player.socketId) {
      const socket = io.sockets.sockets.get(player.socketId);
      if (socket) {
        socket.emit("room_state", serializeRoomForPlayer(room, player.token));
      }
    }
  }
}

function addRoomLog(room, message, type = "info") {
  const time = new Date().toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  room.logs.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    time,
    message,
    type
  });
}

app.get("/api/server-info", (req, res) => {
  const ips = getLocalIPs();
  const port = server.address()?.port || 3000;
  res.json({
    ips,
    port,
    urls: ips.map((ip) => `http://${ip}:${port}`)
  });
});

io.on("connection", (socket) => {
  // Создание новой комнаты
  socket.on("create_room", ({ playerName, playerToken, customBunkerSlots }, callback) => {
    const cleanName = (playerName || "Ведущий Экономист").trim().slice(0, 28);
    const token = playerToken || `tok_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const code = generateRoomCode();
    const catastrophe = CATASTROPHES[Math.floor(Math.random() * CATASTROPHES.length)];

    const hostPlayer = {
      id: `p_${ Math.random().toString(36).slice(2, 9) }`,
      token,
      socketId: socket.id,
      name: cleanName,
      roleTag: "Организатор сессии",
      online: true,
      alive: true,
      cards: null,
      votesReceived: 0,
      hasVoted: false,
      votedFor: null,
      voteWeight: 1,
      voteShield: 0
    };

    const room = {
      code,
      hostToken: token,
      status: "lobby",
      round: 1,
      customBunkerSlots: customBunkerSlots ? Number(customBunkerSlots) : null,
      bunkerSlots: 2,
      catastrophe,
      players: [hostPlayer],
      logs: [],
      reserveDecks: null,
      votingState: null
    };

    addRoomLog(room, `Кабинет бункера #${code} открыт. Организатор: ${cleanName}.`, "system");
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerToken = token;

    broadcastRoom(room);
    if (callback) callback({ ok: true, code, token });
  });

  // Подключение к существующей комнате по коду (или переподключение)
  socket.on("join_room", ({ roomCode, playerName, playerToken }, callback) => {
    const code = (roomCode || "").trim();
    const room = rooms.get(code);
    if (!room) {
      if (callback) callback({ ok: false, error: "Комната с таким кодом не найдена. Проверьте 4 цифры кода." });
      return;
    }

    const cleanName = (playerName || "Участник").trim().slice(0, 28);
    const token = playerToken || `tok_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    let existingPlayer = room.players.find((p) => p.token === token);

    if (existingPlayer) {
      existingPlayer.socketId = socket.id;
      existingPlayer.online = true;
      if (cleanName && cleanName !== "Участник") {
        existingPlayer.name = cleanName;
      }
    } else {
      if (room.status !== "lobby") {
        if (callback) {
          callback({
            ok: false,
            error: "Игра в этой комнате уже началась! Дождитесь новой партии или попросите ведущего перезапустить раунд."
          });
        }
        return;
      }

      existingPlayer = {
        id: `p_${Math.random().toString(36).slice(2, 9)}`,
        token,
        socketId: socket.id,
        name: cleanName,
        roleTag: `Кандидат #${room.players.length + 1}`,
        online: true,
        alive: true,
        cards: null,
        votesReceived: 0,
        hasVoted: false,
        votedFor: null,
        voteWeight: 1,
        voteShield: 0
      };
      room.players.push(existingPlayer);
      room.bunkerSlots = room.customBunkerSlots || calculateBunkerSlots(room.players.length);
      addRoomLog(room, `Кандидат «${cleanName}» зарегистрировался в терминале.`, "join");
    }

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerToken = token;

    broadcastRoom(room);
    if (callback) callback({ ok: true, code, token });
  });

  // Изменение своего имени в любой момент
  socket.on("update_name", ({ newName }, callback) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const player = room.players.find((p) => p.token === socket.data.playerToken);
    if (!player) return;

    const clean = (newName || "").trim().slice(0, 28);
    if (!clean) return;
    const oldName = player.name;
    player.name = clean;
    addRoomLog(room, `Участник «${oldName}» сменил имя в реестре на «${clean}».`, "info");
    broadcastRoom(room);
    if (callback) callback({ ok: true });
  });

  // Смена сценария экономической катастрофы (в лобби, доступно хосту)
  socket.on("change_catastrophe", ({ catastropheId }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostToken !== socket.data.playerToken) return;

    if (catastropheId) {
      const found = CATASTROPHES.find((c) => c.id === catastropheId);
      if (found) room.catastrophe = found;
    } else {
      const others = CATASTROPHES.filter((c) => c.id !== room.catastrophe.id);
      room.catastrophe = others[Math.floor(Math.random() * others.length)];
    }
    addRoomLog(room, `Сценарий кризиса изменен: «${room.catastrophe.title}».`, "system");
    broadcastRoom(room);
  });

  // Настройка количества мест в бункере
  socket.on("set_bunker_slots", ({ slots }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostToken !== socket.data.playerToken) return;
    const num = Math.max(1, Math.min(room.players.length, Number(slots) || 1));
    room.customBunkerSlots = num;
    room.bunkerSlots = num;
    addRoomLog(room, `Квота мест в бункере установлена на: ${num}.`, "system");
    broadcastRoom(room);
  });

  // Добавление демо-ботов (очень удобно для учителя на уроке или тестирования!)
  socket.on("add_bot_players", ({ count = 3 }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostToken !== socket.data.playerToken || room.status !== "lobby") return;

    const botNames = [
      "Адам Смит (AI)",
      "Джон Кейнс (AI)",
      "Милтон Фридман (AI)",
      "Давид Рикардо (AI)",
      "Элинор Остром (AI)",
      "Йозеф Шумпетер (AI)",
      "Дуглас Норт (AI)"
    ];

    const toAdd = Math.min(8, Math.max(1, Number(count) || 1));
    for (let i = 0; i < toAdd; i++) {
      if (room.players.length >= 16) break;
      const usedNames = new Set(room.players.map((p) => p.name));
      const available = botNames.filter((n) => !usedNames.has(n));
      const botName =
        available.length > 0
          ? available[0]
          : `Экономист-Бот #${room.players.length + 1}`;

      room.players.push({
        id: `bot_${Math.random().toString(36).slice(2, 9)}`,
        token: `bot_tok_${Math.random().toString(36).slice(2)}`,
        socketId: null,
        isBot: true,
        name: botName,
        roleTag: "Симуляционный агент",
        online: true,
        alive: true,
        cards: null,
        votesReceived: 0,
        hasVoted: false,
        votedFor: null,
        voteWeight: 1,
        voteShield: 0
      });
    }

    room.bunkerSlots = room.customBunkerSlots || calculateBunkerSlots(room.players.length);
    addRoomLog(room, `В комнату добавлены экономические AI-кандидаты. Всего участников: ${room.players.length}.`, "system");
    broadcastRoom(room);
  });

  // Удаление игрока (в лобби)
  socket.on("remove_player", ({ playerId }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostToken !== socket.data.playerToken || room.status !== "lobby") return;
    const target = room.players.find((p) => p.id === playerId);
    if (!target || target.token === room.hostToken) return;

    room.players = room.players.filter((p) => p.id !== playerId);
    room.bunkerSlots = room.customBunkerSlots || calculateBunkerSlots(room.players.length);
    addRoomLog(room, `Участник «${target.name}» удален из списка.`, "system");
    broadcastRoom(room);
  });

  // Старт игры и раздача карточек по количеству участников
  socket.on("start_game", (_, callback) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostToken !== socket.data.playerToken) return;

    if (room.players.length < 2) {
      if (callback) {
        callback({
          ok: false,
          error: "Для старта игры нужно минимум 2 участника (вы можете подключить друзей с телефонов или добавить AI-кандидатов кнопкой в лобби)."
        });
      }
      return;
    }

    room.status = "playing";
    room.round = 1;
    room.bunkerSlots =
      room.customBunkerSlots || calculateBunkerSlots(room.players.length);
    dealCardsToRoom(room);

    // Если есть AI-боты, откроем им профессию в 1 раунде для наглядности
    room.players.forEach((p) => {
      if (p.isBot && p.cards?.profession) {
        p.cards.profession.revealed = true;
      }
    });

    addRoomLog(
      room,
      `ИГРА НАЧАЛАСЬ! Карточки распределены на ${room.players.length} участников. Мест в бункере: ${room.bunkerSlots}.`,
      "alert"
    );
    broadcastRoom(room);
    if (callback) callback({ ok: true });
  });

  // Открытие своей карточки перед всеми участниками
  socket.on("reveal_card", ({ cardKey }, callback) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || (room.status !== "playing" && room.status !== "voting")) return;

    const player = room.players.find((p) => p.token === socket.data.playerToken);
    if (!player || !player.cards || !player.cards[cardKey]) return;

    const card = player.cards[cardKey];
    if (card.revealed) return;

    card.revealed = true;
    addRoomLog(
      room,
      `${player.name} раскрывает карту [${card.categoryLabel}]: «${card.title}»`,
      "reveal"
    );
    broadcastRoom(room);
    if (callback) callback({ ok: true });
  });

  // Использование спецкарты действия
  socket.on("use_special_card", ({ targetPlayerId }, callback) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || (room.status !== "playing" && room.status !== "voting")) return;

    const player = room.players.find((p) => p.token === socket.data.playerToken);
    if (!player || !player.alive || !player.cards?.special) return;

    const special = player.cards.special;
    if (special.used) {
      if (callback) callback({ ok: false, error: "Спецкарта уже использована!" });
      return;
    }

    special.revealed = true;
    special.used = true;

    const code = special.subtitle || "";
    let effectMessage = `${player.name} активирует спецкарту «${special.title}»!`;

    if (code.includes("ACT-01") || code.includes("ACT-09")) {
      // Вскрытие случайной закрытой карты у выбранного игрока (или любого соперника)
      const candidates = room.players.filter((p) => p.id !== player.id && p.alive);
      const target =
        candidates.find((p) => p.id === targetPlayerId) ||
        candidates[Math.floor(Math.random() * candidates.length)];

      if (target && target.cards) {
        const hiddenKeys = Object.keys(target.cards).filter(
          (k) => !target.cards[k].revealed
        );
        if (hiddenKeys.length > 0) {
          const keyToReveal = hiddenKeys[0];
          target.cards[keyToReveal].revealed = true;
          effectMessage += ` Вскрыта карта игрока ${target.name}: «${target.cards[keyToReveal].title}»!`;
        } else {
          effectMessage += ` У игрока ${target.name} все карты уже открыты.`;
        }
      }
    } else if (code.includes("ACT-02")) {
      player.voteShield += 2;
      effectMessage += ` Получена субсидия ЦБ: -2 голоса против ${player.name} на голосовании.`;
    } else if (code.includes("ACT-03") && room.reserveDecks?.risks?.length > 0) {
      const newRisk = room.reserveDecks.risks.pop();
      player.cards.risk = {
        id: "risk",
        categoryLabel: "ЭКОНОМИЧЕСКИЙ РИСК / ФАКТОР",
        icon: "alert-triangle",
        title: newRisk.title,
        subtitle: `Уровень угрозы: ${newRisk.severity}`,
        badge: newRisk.severity,
        effect: newRisk.effect,
        concept: newRisk.concept,
        revealed: true,
        mitigated: false
      };
      effectMessage += ` Риск реструктурирован на: «${newRisk.title}».`;
    } else if (code.includes("ACT-04")) {
      player.voteWeight = 2;
      effectMessage += ` Контрольный пакет активирован: голос ${player.name} теперь считается за 2!`;
    } else if (code.includes("ACT-05") && room.reserveDecks?.assets?.length > 0) {
      const newAsset = room.reserveDecks.assets.pop();
      player.cards.capital = {
        id: "capital",
        categoryLabel: "КАПИТАЛ И АКТИВЫ",
        icon: "coins",
        title: newAsset.title,
        subtitle: `Ликвидность: ${newAsset.liquidity}`,
        badge: "АКТИВ / РОТАЦИЯ M&A",
        effect: newAsset.effect,
        concept: newAsset.concept,
        revealed: true
      };
      effectMessage += ` Активы обновлены через M&A: «${newAsset.title}».`;
    } else if (code.includes("ACT-06") && room.reserveDecks?.skills?.length > 0) {
      const newSkill = room.reserveDecks.skills.pop();
      player.cards.skill = {
        id: "skill",
        categoryLabel: "ЭКОНОМИЧЕСКИЙ НАВЫК",
        icon: "trending-up",
        title: newSkill.title,
        subtitle: "Повышение квалификации",
        badge: "СИЛЬНАЯ СТОРОНА (ОБНОВЛЕНО)",
        effect: newSkill.effect,
        concept: newSkill.concept,
        revealed: true
      };
      effectMessage += ` Навык модернизирован: «${newSkill.title}».`;
    } else if (code.includes("ACT-08")) {
      if (player.cards.risk) {
        player.cards.risk.mitigated = true;
        player.cards.risk.revealed = true;
        player.cards.risk.badge = "РИСК АМНИСТИРОВАН (0% УГРОЗЫ)";
      }
      effectMessage += ` Экономический риск игрока ${player.name} полностью нейтрализован налоговой амнистией!`;
    } else if (code.includes("ACT-10")) {
      if (player.cards.capital) {
        player.cards.capital.title += " + Золотой Стабилизационный Транш";
        player.cards.capital.badge = "УСИЛЕННЫЙ АКТИВ МВФ";
        player.cards.capital.revealed = true;
      }
      effectMessage += ` Капитал игрока ${player.name} усилен стабилизационным траншем!`;
    }

    addRoomLog(room, effectMessage, "special");
    broadcastRoom(room);
    if (callback) callback({ ok: true, message: effectMessage });
  });

  // Хост может открыть случайную карту у AI-ботов, чтобы урок шел динамично
  socket.on("host_reveal_bot_cards", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostToken !== socket.data.playerToken) return;

    room.players.forEach((p) => {
      if (p.isBot && p.alive && p.cards) {
        const nextHidden = Object.values(p.cards).find((c) => !c.revealed);
        if (nextHidden) {
          nextHidden.revealed = true;
          addRoomLog(
            room,
            `${p.name} раскрывает карту [${nextHidden.categoryLabel}]: «${nextHidden.title}»`,
            "reveal"
          );
        }
      }
    });
    broadcastRoom(room);
  });

  // Запуск голосования за исключение кандидата
  socket.on("start_voting", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostToken !== socket.data.playerToken) return;
    if (room.status !== "playing") return;

    room.status = "voting";
    room.players.forEach((p) => {
      p.votesReceived = 0;
      p.hasVoted = false;
      p.votedFor = null;
    });

    // AI-боты автоматически голосуют случайно
    const alivePlayers = room.players.filter((p) => p.alive);
    room.players.forEach((p) => {
      if (p.isBot && p.alive && alivePlayers.length > 1) {
        const targets = alivePlayers.filter((t) => t.id !== p.id);
        const chosen = targets[Math.floor(Math.random() * targets.length)];
        if (chosen) {
          p.hasVoted = true;
          p.votedFor = chosen.id;
          chosen.votesReceived += p.voteWeight || 1;
        }
      }
    });

    addRoomLog(
      room,
      `РАУНД ${room.round}: Открыто голосование Экономического Совета за отсев кандидата!`,
      "alert"
    );
    broadcastRoom(room);
  });

  // Голос участника
  socket.on("cast_vote", ({ targetPlayerId }, callback) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.status !== "voting") return;

    const voter = room.players.find((p) => p.token === socket.data.playerToken);
    const target = room.players.find((p) => p.id === targetPlayerId);

    if (!voter || !voter.alive || voter.hasVoted || !target || !target.alive) {
      if (callback) callback({ ok: false, error: "Голосование недоступно." });
      return;
    }

    voter.hasVoted = true;
    voter.votedFor = target.id;
    target.votesReceived += voter.voteWeight || 1;

    addRoomLog(
      room,
      `${voter.name} отдал голос в Экономическом Совете (вес голоса: ${voter.voteWeight}).`,
      "vote"
    );
    broadcastRoom(room);
    if (callback) callback({ ok: true });
  });

  // Завершение голосования и подведение итогов раунда
  socket.on("finish_voting", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostToken !== socket.data.playerToken || room.status !== "voting") return;

    const alivePlayers = room.players.filter((p) => p.alive);
    let maxEffectiveVotes = -1;
    let eliminated = null;

    alivePlayers.forEach((p) => {
      const effectiveVotes = Math.max(0, p.votesReceived - (p.voteShield || 0));
      if (effectiveVotes > maxEffectiveVotes) {
        maxEffectiveVotes = effectiveVotes;
        eliminated = p;
      }
    });

    if (eliminated && maxEffectiveVotes > 0) {
      eliminated.alive = false;
      // Раскрываем все карты выбывшего для образовательного разбора
      if (eliminated.cards) {
        Object.values(eliminated.cards).forEach((c) => {
          c.revealed = true;
        });
      }
      addRoomLog(
        room,
        `По решению Совета проект бункера покидает «${eliminated.name}» (голосов: ${maxEffectiveVotes}). Все его карты раскрыты для экономического разбора.`,
        "alert"
      );
    } else {
      addRoomLog(
        room,
        `Голосование завершилось без исключения (голоса не поданы или сработал иммунитет).`,
        "info"
      );
    }

    // Сбрасываем одноразовые щиты и двойные голоса
    room.players.forEach((p) => {
      p.voteShield = 0;
      p.voteWeight = 1;
      p.votesReceived = 0;
      p.hasVoted = false;
      p.votedFor = null;
    });

    const remainingAlive = room.players.filter((p) => p.alive).length;
    if (remainingAlive <= room.bunkerSlots) {
      room.status = "finished";
      // Раскрываем все карты выживших в финале
      room.players.forEach((p) => {
        if (p.cards) {
          Object.values(p.cards).forEach((c) => (c.revealed = true));
        }
      });
      addRoomLog(
        room,
        `ГЕРМОЗАТВОРЫ ЗАКРЫТЫ! Сформирован финальный состав Экономического Бункера (${remainingAlive} чел.).`,
        "system"
      );
    } else {
      room.status = "playing";
      room.round += 1;
      addRoomLog(
        room,
        `Начинается РАУНД ${room.round}. Осталось кандидатов: ${remainingAlive}, мест в бункере: ${room.bunkerSlots}.`,
        "system"
      );
    }

    broadcastRoom(room);
  });

  // Следующий раунд без голосования (если ведущий хочет просто перейти к следующему событию)
  socket.on("next_round_no_vote", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostToken !== socket.data.playerToken) return;
    room.status = "playing";
    room.round += 1;
    addRoomLog(room, `Ведущий перевел игру в РАУНД ${room.round}.`, "system");
    broadcastRoom(room);
  });

  // Перезапуск игры в той же комнате (новая раздача карт и новый кризис)
  socket.on("restart_game", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostToken !== socket.data.playerToken) return;

    room.status = "lobby";
    room.round = 1;
    room.catastrophe = CATASTROPHES[Math.floor(Math.random() * CATASTROPHES.length)];
    room.players.forEach((p) => {
      p.alive = true;
      p.cards = null;
      p.votesReceived = 0;
      p.hasVoted = false;
      p.votedFor = null;
      p.voteWeight = 1;
      p.voteShield = 0;
    });
    addRoomLog(room, `Комната возвращена в лобби для новой партии.`, "system");
    broadcastRoom(room);
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    const token = socket.data.playerToken;
    if (!code || !rooms.has(code)) return;

    const room = rooms.get(code);
    const player = room.players.find((p) => p.token === token);
    if (player) {
      player.online = false;
      broadcastRoom(room);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  const ips = getLocalIPs();
  console.log("====================================================");
  console.log("  ЭКОНОМИЧЕСКИЙ БУНКЕР (ECON-BUNKER) ЗАПУЩЕН!");
  console.log(`  Локальный адрес: http://localhost:${PORT}`);
  ips.forEach((ip) => {
    console.log(`  Для подключения с телефонов в сети: http://${ip}:${PORT}`);
  });
  console.log("====================================================");
});
