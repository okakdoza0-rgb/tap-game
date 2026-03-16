module.exports = function setupGroupAds({ bot, pool }) {
  const GROUP_AD_INTERVAL_MS = 24 * 60 * 60 * 1000; // раз в 24 часа
  const GROUP_AD_CHECK_MS = 60 * 60 * 1000; // проверка каждый час

  function getDailyArTapAdText() {
    return `🔥 ArTap

👆 Тапай и зарабатывай монеты
⚡ Улучшайся
👥 Приглашай друзей
🏆 Стань топ игроком

🎮 Начни играть прямо сейчас!`;
  }

  async function initGroupAdsTable() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS promo_groups (
        chat_id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'Группа',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        added_at BIGINT NOT NULL DEFAULT 0,
        last_sent_at BIGINT NOT NULL DEFAULT 0
      )
    `);
  }

  async function savePromoGroup(chatId, title = "Группа") {
    await pool.query(
      `INSERT INTO promo_groups (chat_id, title, is_active, added_at, last_sent_at)
       VALUES ($1, $2, TRUE, $3, 0)
       ON CONFLICT (chat_id) DO UPDATE SET
         title = EXCLUDED.title,
         is_active = TRUE`,
      [String(chatId), String(title || "Группа"), Date.now()]
    );
  }

  async function disablePromoGroup(chatId) {
    await pool.query(
      `UPDATE promo_groups
       SET is_active = FALSE
       WHERE chat_id = $1`,
      [String(chatId)]
    );
  }

  async function sendDailyGroupAds() {
    try {
      const now = Date.now();

      const result = await pool.query(
        `SELECT chat_id, last_sent_at
         FROM promo_groups
         WHERE is_active = TRUE`
      );

      for (const row of result.rows) {
        const chatId = String(row.chat_id || "").trim();
        const lastSentAt = Number(row.last_sent_at || 0);

        if (!chatId) continue;
        if (now - lastSentAt < GROUP_AD_INTERVAL_MS) continue;

        try {
          await bot.sendMessage(chatId, getDailyArTapAdText());

          await pool.query(
            `UPDATE promo_groups
             SET last_sent_at = $1
             WHERE chat_id = $2`,
            [now, chatId]
          );

          console.log("Реклама отправлена в группу:", chatId);
        } catch (error) {
          console.log("Ошибка отправки рекламы в группу:", chatId, error.message);
        }
      }
    } catch (error) {
      console.log("Ошибка sendDailyGroupAds:", error);
    }
  }

  bot.on("my_chat_member", async (msg) => {
    try {
      const chat = msg.chat;
      const newStatus = msg.new_chat_member?.status;
      const oldStatus = msg.old_chat_member?.status;

      if (!chat || !chat.id) return;
      if (chat.type !== "group" && chat.type !== "supergroup") return;

      const chatId = String(chat.id);
      const title = chat.title || "Группа";

      const becameActive =
        ["member", "administrator"].includes(newStatus) &&
        !["member", "administrator"].includes(oldStatus);

      const becameRemoved = ["left", "kicked"].includes(newStatus);

      if (becameActive) {
        await savePromoGroup(chatId, title);

        try {
          await bot.sendMessage(chatId, getDailyArTapAdText());
        } catch (error) {
          console.log("Ошибка приветственной рекламы в группу:", chatId, error.message);
        }
      }

      if (becameRemoved) {
        await disablePromoGroup(chatId);
      }
    } catch (error) {
      console.log("Ошибка my_chat_member:", error);
    }
  });

  bot.on("message", async (msg) => {
    try {
      if (!msg.chat) return;
      if (msg.chat.type !== "group" && msg.chat.type !== "supergroup") return;

      await savePromoGroup(msg.chat.id, msg.chat.title || "Группа");
    } catch (error) {
      console.log("Ошибка сохранения группы:", error.message);
    }
  });

  return {
    initGroupAdsTable,
    start() {
      setInterval(sendDailyGroupAds, GROUP_AD_CHECK_MS);
    }
  };
};
