const socket = io();

// Состояние клиента
let currentRoomState = null;
let myToken = localStorage.getItem("econ_bunker_token") || "";
let myName = localStorage.getItem("econ_bunker_name") || "";
let savedRoomCode = localStorage.getItem("econ_bunker_room") || "";

if (!myToken) {
  myToken = `tok_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  localStorage.setItem("econ_bunker_token", myToken);
}

// Ссылки на DOM-элементы
const welcomeScreen = document.getElementById("welcomeScreen");
const lobbyScreen = document.getElementById("lobbyScreen");
const gameScreen = document.getElementById("gameScreen");
const hudRoomBar = document.getElementById("hudRoomBar");

const playerNameInput = document.getElementById("playerNameInput");
const roomCodeInput = document.getElementById("roomCodeInput");
const customSlotsInput = document.getElementById("customSlotsInput");
const authErrorBox = document.getElementById("authErrorBox");

// Заполняем сохраненное имя
if (myName) {
  playerNameInput.value = myName;
}

// Проверяем URL-параметр ?room=XXXX (для быстрого входа по ссылке/QR)
const urlParams = new URLSearchParams(window.location.search);
const roomFromUrl = urlParams.get("room");
if (roomFromUrl) {
  roomCodeInput.value = roomFromUrl.slice(0, 4);
}

// Утилита всплывающих уведомлений
function showToast(text) {
  const container = document.getElementById("toastContainer");
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  container.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 3800);
}

function showError(msg) {
  authErrorBox.textContent = msg;
  authErrorBox.classList.remove("hidden");
}

function clearError() {
  authErrorBox.classList.add("hidden");
}

function switchScreen(screenId) {
  [welcomeScreen, lobbyScreen, gameScreen].forEach((s) => s.classList.remove("active"));
  document.getElementById(screenId).classList.add("active");
  if (screenId === "welcomeScreen") {
    hudRoomBar.classList.add("hidden");
  } else {
    hudRoomBar.classList.remove("hidden");
  }
}

// Переключение табов Вход / Создание на главном экране
const tabJoinBtn = document.getElementById("tabJoinBtn");
const tabCreateBtn = document.getElementById("tabCreateBtn");
const joinPanel = document.getElementById("joinPanel");
const createPanel = document.getElementById("createPanel");

tabJoinBtn.addEventListener("click", () => {
  tabJoinBtn.classList.add("active");
  tabCreateBtn.classList.remove("active");
  joinPanel.classList.add("active");
  createPanel.classList.remove("active");
  clearError();
});

tabCreateBtn.addEventListener("click", () => {
  tabCreateBtn.classList.add("active");
  tabJoinBtn.classList.remove("active");
  createPanel.classList.add("active");
  joinPanel.classList.remove("active");
  clearError();
});

// Загрузка локальных IP-адресов сервера для подсказки в лобби
async function loadServerNetworkInfo(roomCode) {
  try {
    const res = await fetch("/api/server-info");
    const data = await res.json();
    const hintEl = document.getElementById("serverAddressesHint");
    if (data.urls && data.urls.length > 0) {
      hintEl.innerHTML = `Адрес для телефонов в одной Wi-Fi сети: <strong>${data.urls[0]}?room=${roomCode}</strong>`;
    }
  } catch (e) {
    // Игнорируем ошибку, если недоступно
  }
}

// СОЗДАНИЕ КОМНАТЫ
document.getElementById("createRoomSubmitBtn").addEventListener("click", () => {
  clearError();
  const name = playerNameInput.value.trim() || "Ведущий Экономист";
  myName = name;
  localStorage.setItem("econ_bunker_name", myName);

  const customBunkerSlots = customSlotsInput.value ? Number(customSlotsInput.value) : null;

  socket.emit(
    "create_room",
    { playerName: myName, playerToken: myToken, customBunkerSlots },
    (res) => {
      if (!res || !res.ok) {
        showError(res?.error || "Не удалось создать комнату.");
        return;
      }
      savedRoomCode = res.code;
      localStorage.setItem("econ_bunker_room", savedRoomCode);
      loadServerNetworkInfo(res.code);
      showToast(`Комната #${res.code} открыта!`);
    }
  );
});

// ВХОД В КОМНАТУ ПО КОДУ
document.getElementById("joinRoomSubmitBtn").addEventListener("click", () => {
  clearError();
  const code = roomCodeInput.value.trim();
  if (code.length !== 4) {
    showError("Введите 4-значный код комнаты.");
    return;
  }
  const name = playerNameInput.value.trim() || `Участник-${Math.floor(100 + Math.random() * 900)}`;
  myName = name;
  localStorage.setItem("econ_bunker_name", myName);

  socket.emit(
    "join_room",
    { roomCode: code, playerName: myName, playerToken: myToken },
    (res) => {
      if (!res || !res.ok) {
        showError(res?.error || "Ошибка подключения к комнате.");
        return;
      }
      savedRoomCode = res.code;
      localStorage.setItem("econ_bunker_room", savedRoomCode);
      loadServerNetworkInfo(res.code);
      showToast(`Вы вошли в бункер #${res.code}`);
    }
  );
});

// Авто-переподключение, если пользователь обновил страницу
socket.on("connect", () => {
  if (savedRoomCode && myToken) {
    socket.emit(
      "join_room",
      { roomCode: savedRoomCode, playerName: myName || "Участник", playerToken: myToken },
      (res) => {
        if (!res || !res.ok) {
          localStorage.removeItem("econ_bunker_room");
          savedRoomCode = "";
        } else {
          loadServerNetworkInfo(savedRoomCode);
        }
      }
    );
  }
});

// Выход из комнаты
document.getElementById("leaveRoomBtn").addEventListener("click", () => {
  localStorage.removeItem("econ_bunker_room");
  savedRoomCode = "";
  currentRoomState = null;
  window.history.replaceState({}, document.title, "/");
  window.location.reload();
});

// Копирование ссылки с кодом комнаты
function copyRoomInvite() {
  if (!currentRoomState) return;
  const inviteUrl = `${window.location.origin}/?room=${currentRoomState.code}`;
  navigator.clipboard
    .writeText(inviteUrl)
    .then(() => {
      showToast(`Ссылка скопирована! Код комнаты: ${currentRoomState.code}`);
    })
    .catch(() => {
      showToast(`Код комнаты: ${currentRoomState.code}`);
    });
}

document.getElementById("copyRoomLinkBtn").addEventListener("click", copyRoomInvite);
document.getElementById("copyInviteBtn").addEventListener("click", copyRoomInvite);

// Модальное окно смены своего имени
const nameModal = document.getElementById("nameModal");
const newNameModalInput = document.getElementById("newNameModalInput");

function openNameModal() {
  newNameModalInput.value = myName;
  nameModal.classList.remove("hidden");
  newNameModalInput.focus();
}

function closeNameModal() {
  nameModal.classList.add("hidden");
}

document.getElementById("editMyNameBtn").addEventListener("click", openNameModal);
document.getElementById("closeNameModalBtn").addEventListener("click", closeNameModal);
document.getElementById("cancelNameModalBtn").addEventListener("click", closeNameModal);

document.getElementById("saveNameModalBtn").addEventListener("click", () => {
  const val = newNameModalInput.value.trim();
  if (!val) return;
  myName = val;
  localStorage.setItem("econ_bunker_name", myName);
  socket.emit("update_name", { newName: myName }, () => {
    closeNameModal();
    showToast(`Имя изменено на «${myName}»`);
  });
});

// Кнопки управления в лобби (для ведущего)
document.getElementById("addBotsBtn").addEventListener("click", () => {
  socket.emit("add_bot_players", { count: 3 });
  showToast("Добавлены 3 AI-кандидата для симуляции!");
});

document.getElementById("changeCrisisBtn").addEventListener("click", () => {
  socket.emit("change_catastrophe", {});
});

document.getElementById("lobbySlotsSelect").addEventListener("change", (e) => {
  socket.emit("set_bunker_slots", { slots: Number(e.target.value) });
});

document.getElementById("startGameBtn").addEventListener("click", () => {
  socket.emit("start_game", {}, (res) => {
    if (res && !res.ok) {
      showToast(res.error);
    }
  });
});

// Кнопки управления раундом (для ведущего)
document.getElementById("startVotingBtn").addEventListener("click", () => {
  socket.emit("start_voting");
});

document.getElementById("finishVotingBtn").addEventListener("click", () => {
  socket.emit("finish_voting");
});

document.getElementById("nextRoundNoVoteBtn").addEventListener("click", () => {
  socket.emit("next_round_no_vote");
});

document.getElementById("revealBotsBtn").addEventListener("click", () => {
  socket.emit("host_reveal_bot_cards");
  showToast("AI-кандидаты раскрыли по 1 карточке");
});

document.getElementById("restartGameBtn").addEventListener("click", () => {
  socket.emit("restart_game");
});

// Вкладки рабочего пространства в игре
const wsTabs = document.querySelectorAll(".ws-tab");
const wsPanels = document.querySelectorAll(".ws-panel");

wsTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const targetId = tab.getAttribute("data-tab");
    wsTabs.forEach((t) => t.classList.remove("active"));
    wsPanels.forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(targetId).classList.add("active");
  });
});

// Модальное окно выбора цели для спецкарты
const targetModal = document.getElementById("targetModal");
document.getElementById("closeTargetModalBtn").addEventListener("click", () => {
  targetModal.classList.add("hidden");
});
document.getElementById("cancelTargetModalBtn").addEventListener("click", () => {
  targetModal.classList.add("hidden");
});

function openSpecialCardTargetModal(specialCard) {
  if (!currentRoomState) return;
  const code = specialCard.subtitle || "";
  const needsTarget = code.includes("ACT-01") || code.includes("ACT-09");

  if (!needsTarget) {
    socket.emit("use_special_card", {}, (res) => {
      if (res?.message) showToast(res.message);
    });
    return;
  }

  const listEl = document.getElementById("targetPlayersList");
  document.getElementById("targetModalDesc").textContent =
    "Выберите участника, у которого вы хотите принудительно вскрыть закрытую карточку:";
  listEl.innerHTML = "";

  const others = currentRoomState.players.filter((p) => !p.isMe && p.alive);
  others.forEach((p) => {
    const btn = document.createElement("button");
    btn.className = "btn btn-outline btn-block";
    btn.textContent = `Вскрыть карту у: ${p.name}`;
    btn.addEventListener("click", () => {
      socket.emit("use_special_card", { targetPlayerId: p.id }, (res) => {
        targetModal.classList.add("hidden");
        if (res?.message) showToast(res.message);
      });
    });
    listEl.appendChild(btn);
  });

  targetModal.classList.remove("hidden");
}

// Рендер макроэкономических показателей катастрофы
function renderMacroGrid(containerId, macroIndicators) {
  const container = document.getElementById(containerId);
  if (!container || !macroIndicators) return;
  container.innerHTML = `
    <div class="macro-box">
      <span>Уровень инфляции</span>
      <strong>${macroIndicators.inflation}</strong>
    </div>
    <div class="macro-box">
      <span>Падение мирового ВВП</span>
      <strong>${macroIndicators.gdpDrop}</strong>
    </div>
    <div class="macro-box">
      <span>Безработица</span>
      <strong>${macroIndicators.unemployment}</strong>
    </div>
    <div class="macro-box">
      <span>Новая система обмена</span>
      <strong>${macroIndicators.dominantSystem}</strong>
    </div>
  `;
}

// Главная функция отрисовки состояния комнаты
socket.on("room_state", (state) => {
  currentRoomState = state;
  const me = state.players.find((p) => p.isMe);
  const isHost = me && me.isHost;

  if (me) {
    myName = me.name;
    document.getElementById("hudMyName").textContent = me.name;
  }

  // Обновляем верхний HUD
  document.getElementById("hudRoomCode").textContent = state.code;
  document.getElementById("hudRound").textContent = state.round;
  const aliveCount = state.players.filter((p) => p.alive).length;
  document.getElementById("hudSlots").textContent = `${state.bunkerSlots} из ${aliveCount}`;

  // Показываем/скрываем элементы только для ведущего (хоста)
  document.querySelectorAll(".host-only").forEach((el) => {
    if (isHost) {
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  });

  if (state.status === "lobby") {
    switchScreen("lobbyScreen");
    renderLobby(state, isHost);
  } else {
    switchScreen("gameScreen");
    renderGame(state, me, isHost);
  }
});

function renderLobby(state, isHost) {
  document.getElementById("lobbyPlayerCount").textContent = state.players.length;
  document.getElementById("lobbyRoomCodeDisplay").textContent = state.code;
  document.getElementById("lobbySlotsSelect").value = String(state.bunkerSlots);

  const guestNotice = document.getElementById("lobbyGuestNotice");
  if (isHost) {
    guestNotice.classList.add("hidden");
  } else {
    guestNotice.classList.remove("hidden");
  }

  // Список игроков в лобби
  const listEl = document.getElementById("lobbyPlayersList");
  listEl.innerHTML = "";
  state.players.forEach((p, idx) => {
    const chip = document.createElement("div");
    chip.className = `lobby-player-chip ${p.isMe ? "is-me" : ""}`;
    chip.innerHTML = `
      <div class="p-chip-info">
        <strong>${idx + 1}. ${p.name} ${p.isMe ? "(Вы)" : ""}</strong>
        <span>${p.isHost ? "👑 Ведущий комнаты" : p.roleTag}</span>
      </div>
      <div class="p-chip-actions"></div>
    `;
    const actionsBox = chip.querySelector(".p-chip-actions");
    if (p.isMe) {
      const editBtn = document.createElement("button");
      editBtn.className = "btn btn-ghost btn-sm";
      editBtn.textContent = "✎ Имя";
      editBtn.addEventListener("click", openNameModal);
      actionsBox.appendChild(editBtn);
    } else if (isHost) {
      const kickBtn = document.createElement("button");
      kickBtn.className = "btn btn-danger-outline btn-sm";
      kickBtn.textContent = "✕";
      kickBtn.title = "Удалить из комнаты";
      kickBtn.addEventListener("click", () => {
        socket.emit("remove_player", { playerId: p.id });
      });
      actionsBox.appendChild(kickBtn);
    }
    listEl.appendChild(chip);
  });

  // Сценарий катастрофы в лобби
  const cat = state.catastrophe;
  if (cat) {
    document.getElementById("lobbyCrisisTitle").textContent = cat.title;
    document.getElementById("lobbyCrisisCode").textContent = cat.code;
    document.getElementById("lobbyCrisisDesc").textContent = cat.description;
    renderMacroGrid("lobbyMacroGrid", cat.macroIndicators);

    document.getElementById("lobbyBunkerName").textContent = cat.bunkerInfo.name;
    document.getElementById("lobbyBunkerDuration").textContent = `Срок изоляции: ${cat.bunkerInfo.duration}`;
    const resList = document.getElementById("lobbyBunkerResources");
    resList.innerHTML = cat.bunkerInfo.resources.map((r) => `<li>${r}</li>`).join("");
    document.getElementById("lobbyBunkerObjective").innerHTML = `<strong>Главная экономическая задача:</strong> ${cat.bunkerInfo.objective}`;
  }
}

function renderGame(state, me, isHost) {
  // Верхний баннер раунда
  const ev = state.roundEvent;
  if (ev) {
    document.getElementById("gameRoundBadge").textContent =
      state.status === "finished" ? "ФИНАЛ ИГРЫ" : `РАУНД ${state.round}`;
    document.getElementById("gameCrisisMiniTag").textContent = state.catastrophe?.title || "";
    document.getElementById("gameRoundTitle").textContent =
      state.status === "finished"
        ? "Итоги отбора в Экономический Бункер подведены!"
        : ev.title;
    document.getElementById("gameRoundDesc").textContent =
      state.status === "finished"
        ? "Все карточки участников открыты. Проведите финальный разбор экономической эффективности сформированной команды!"
        : ev.eventDescription;
    document.getElementById("gameDiscussionPrompt").textContent = ev.questionForClass;
  }

  // Индексы аналитики бункера
  const an = state.analytics;
  if (an) {
    document.getElementById("transparencyBadge").textContent = `Раскрыто карт: ${an.transparencyPercent}%`;
    document.getElementById("metricProdVal").textContent = `${an.productionScore}%`;
    document.getElementById("metricProdBar").style.width = `${an.productionScore}%`;

    document.getElementById("metricFinVal").textContent = `${an.financeStability}%`;
    document.getElementById("metricFinBar").style.width = `${an.financeStability}%`;

    document.getElementById("metricResVal").textContent = `${an.resourceSecurity}%`;
    document.getElementById("metricResBar").style.width = `${an.resourceSecurity}%`;
  }

  // Кнопки голосования у хоста и баннер голосования
  const votingBanner = document.getElementById("votingAlertBanner");
  const startVotingBtn = document.getElementById("startVotingBtn");
  const finishVotingBtn = document.getElementById("finishVotingBtn");

  if (state.status === "voting") {
    votingBanner.classList.remove("hidden");
    startVotingBtn.classList.add("hidden");
    if (isHost) finishVotingBtn.classList.remove("hidden");
  } else {
    votingBanner.classList.add("hidden");
    if (isHost && state.status === "playing") {
      startVotingBtn.classList.remove("hidden");
    } else {
      startVotingBtn.classList.add("hidden");
    }
    finishVotingBtn.classList.add("hidden");
  }

  // Статус игрока
  const statusPill = document.getElementById("myPlayerStatusPill");
  if (me && me.alive) {
    statusPill.className = "status-pill status-alive";
    statusPill.textContent =
      state.status === "finished" ? "ВЫ ПРОШЛИ В БУНКЕР! 🎉" : "В ИГРЕ // ДЕЙСТВУЮЩИЙ КАНДИДАТ";
  } else {
    statusPill.className = "status-pill status-eliminated";
    statusPill.textContent = "ВЫБЫЛ ПО ИТОГАМ ГОЛОСОВАНИЯ";
  }

  // Рендер 5 личных карточек игрока
  const myCardsContainer = document.getElementById("myCardsContainer");
  myCardsContainer.innerHTML = "";

  if (me && me.cards) {
    const order = ["profession", "capital", "skill", "risk", "special"];
    order.forEach((key) => {
      const card = me.cards[key];
      if (!card) return;

      const cardEl = document.createElement("div");
      cardEl.className = `econ-card ${card.revealed ? "card-revealed" : ""}`;
      cardEl.setAttribute("data-category", key);

      const isSpecial = key === "special";
      let actionButtonHtml = "";

      if (isSpecial) {
        if (card.used) {
          actionButtonHtml = `<button class="btn btn-ghost btn-block btn-sm" disabled>✓ Спецкарта активирована</button>`;
        } else if (me.alive) {
          actionButtonHtml = `<button class="btn btn-gold btn-block btn-sm use-special-btn">⚡ Использовать спецкарту инсайдера</button>`;
        }
      } else {
        if (card.revealed) {
          actionButtonHtml = `<button class="btn btn-ghost btn-block btn-sm" disabled>👁 Карта открыта всем участникам</button>`;
        } else {
          actionButtonHtml = `<button class="btn btn-primary btn-block btn-sm reveal-card-btn">📢 Раскрыть карточку перед классом</button>`;
        }
      }

      cardEl.innerHTML = `
        <div>
          <div class="card-top-meta">
            <span class="card-cat-tag">${card.categoryLabel}</span>
            <span class="card-visibility-badge ${card.revealed ? "vis-open" : "vis-hidden"}">
              ${card.revealed ? "ОТКРЫТА ВСЕМ" : "СКРЫТА"}
            </span>
          </div>
          <h4 class="card-main-title">${card.title}</h4>
          <div class="card-subtitle">${card.subtitle} • ${card.badge}</div>
          <div class="card-effect-box">${card.effect}</div>
          <div class="card-concept-box">
            <strong>Экономическое понятие урока:</strong>
            ${card.concept}
          </div>
        </div>
        <div class="card-footer-action">
          ${actionButtonHtml}
        </div>
      `;

      const revealBtn = cardEl.querySelector(".reveal-card-btn");
      if (revealBtn) {
        revealBtn.addEventListener("click", () => {
          socket.emit("reveal_card", { cardKey: key }, () => {
            showToast(`Вы раскрыли карту: «${card.title}»`);
          });
        });
      }

      const specialBtn = cardEl.querySelector(".use-special-btn");
      if (specialBtn) {
        specialBtn.addEventListener("click", () => {
          openSpecialCardTargetModal(card);
        });
      }

      myCardsContainer.appendChild(cardEl);
    });
  }

  // Рендер общего дашборда всех участников
  const alivePlayersCount = state.players.filter((p) => p.alive).length;
  document.getElementById("boardAliveCounter").textContent = `${alivePlayersCount}/${state.players.length}`;

  const boardEl = document.getElementById("allPlayersBoard");
  boardEl.innerHTML = "";

  state.players.forEach((p) => {
    const pCard = document.createElement("div");
    pCard.className = `player-dossier-card ${p.isMe ? "is-me" : ""} ${!p.alive ? "eliminated" : ""}`;

    const initials = p.name.slice(0, 2).toUpperCase();
    const canVoteAgainst =
      state.status === "voting" &&
      me &&
      me.alive &&
      !me.hasVoted &&
      p.alive &&
      !p.isMe;

    let cardsListHtml = "";
    if (p.cards) {
      const order = ["profession", "capital", "skill", "risk", "special"];
      order.forEach((k) => {
        const c = p.cards[k];
        if (!c) return;
        if (c.hidden) {
          cardsListHtml += `
            <div class="mini-card-item hidden-card">
              <span class="mini-cat">${c.categoryLabel}</span>
              <span>🔒 Засекречено кандидатом</span>
            </div>
          `;
        } else {
          cardsListHtml += `
            <div class="mini-card-item revealed">
              <span class="mini-cat">${c.categoryLabel} ${c.revealed ? "• ОТКРЫТО" : "• ВАША КАРТА"}</span>
              <div class="mini-title">${c.title}</div>
            </div>
          `;
        }
      });
    }

    pCard.innerHTML = `
      <div class="p-card-header">
        <div class="p-identity">
          <div class="p-avatar">${initials}</div>
          <div>
            <div class="p-name-row">
              <strong>${p.name}</strong>
              ${p.isMe ? '<span class="copy-badge">ВЫ</span>' : ""}
            </div>
            <div class="p-role-sub">
              ${!p.alive ? "❌ Исключен из бункера" : p.hasVoted ? "✓ Проголосовал" : "В совете бункера"}
              ${p.voteShield > 0 ? ` • Щит ЦБ (-${p.voteShield})` : ""}
            </div>
          </div>
        </div>
        ${
          state.status === "voting" || p.votesReceived > 0
            ? `<div class="vote-counter-pill">Голосов: ${p.votesReceived}</div>`
            : ""
        }
      </div>

      <div class="p-mini-cards-list">
        ${cardsListHtml}
      </div>

      <div class="p-card-vote-box"></div>
    `;

    if (canVoteAgainst) {
      const voteBtn = document.createElement("button");
      voteBtn.className = "btn btn-danger-outline btn-block btn-sm";
      voteBtn.textContent = `🗳 Голосовать против «${p.name}»`;
      voteBtn.addEventListener("click", () => {
        socket.emit("cast_vote", { targetPlayerId: p.id }, (res) => {
          if (res?.ok) {
            showToast(`Голос против ${p.name} принят!`);
          }
        });
      });
      pCard.querySelector(".p-card-vote-box").appendChild(voteBtn);
    }

    boardEl.appendChild(pCard);
  });

  // Журнал событий
  const logsEl = document.getElementById("gameLogsList");
  logsEl.innerHTML = state.logs
    .slice()
    .reverse()
    .map(
      (l) => `
      <div class="log-entry log-${l.type}">
        <span class="log-time">${l.time}</span>
        <span>${l.message}</span>
      </div>
    `
    )
    .join("");

  // Вкладка 3: Паспорт бункера и раскрытые понятия урока
  const cat = state.catastrophe;
  if (cat) {
    document.getElementById("detailCrisisTitle").textContent = cat.title;
    document.getElementById("detailCrisisDesc").textContent = cat.description;
    renderMacroGrid("detailMacroGrid", cat.macroIndicators);
    document.getElementById("detailBunkerName").textContent = cat.bunkerInfo.name;
    document.getElementById("detailBunkerDuration").textContent = cat.bunkerInfo.duration;
    document.getElementById("detailBunkerResources").innerHTML = cat.bunkerInfo.resources
      .map((r) => `<li>${r}</li>`)
      .join("");
    document.getElementById("detailBunkerObjective").innerHTML = `<strong>Задача выживших:</strong> ${cat.bunkerInfo.objective}`;
  }

  const conceptsEl = document.getElementById("activeConceptsList");
  if (an && an.activeConcepts && an.activeConcepts.length > 0) {
    conceptsEl.innerHTML = an.activeConcepts
      .map(
        (item) => `
        <div class="concept-item">
          <strong>${item.cardTitle} (${item.playerName})</strong>
          <span>Понятие: ${item.concept}</span>
        </div>
      `
      )
      .join("");
  } else {
    conceptsEl.innerHTML = `<p class="text-muted">Как только участники начнут раскрывать свои карточки, здесь появится список экономических терминов для обсуждения на уроке.</p>`;
  }
}
