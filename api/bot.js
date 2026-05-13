const express = require("express");
const { Telegraf, Markup } = require("telegraf");
const { createClient } = require("@supabase/supabase-js");

// =====================
// ENV VARIABLES
// =====================
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID; // Admin Telegram ID (raqam)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // https://your-app.vercel.app/api/bot

// =====================
// INIT
// =====================
const bot = new Telegraf(BOT_TOKEN);
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const app = express();

app.use(express.json());

// =====================
// /start COMMAND
// =====================
bot.start(async (ctx) => {
  const user = ctx.from;

  // Userni Supabase'ga saqlash (mavjud bo'lmasa)
  const { error } = await supabase.from("users").upsert(
    {
      telegram_id: user.id,
      username: user.username || null,
      full_name: `${user.first_name} ${user.last_name || ""}`.trim(),
    },
    { onConflict: "telegram_id" }
  );

  if (error) console.error("Users upsert error:", error.message);

  const webAppUrl = process.env.WEBAPP_URL;

  if (webAppUrl) {
    await ctx.reply(
      `👋 Xush kelibsiz, ${user.first_name}!\n\nKIMOTO MARKET'ga xush kelibsiz. Quyidagi tugma orqali do'konni oching:`,
      Markup.keyboard([
        [Markup.button.webApp("🛒 Do'konni ochish", webAppUrl)],
      ]).resize()
    );
  } else {
    await ctx.reply(
      `👋 Xush kelibsiz, ${user.first_name}!\n\nKIMOTO MARKET'ga xush kelibsiz! 🛒\n\nDo'konimizga kirish uchun quyidagi havoladan foydalaning.`,
      Markup.inlineKeyboard([
        [Markup.button.url("🛒 Do'konni ochish", "https://my-market.vercel.app")],
      ])
    );
  }
});

// =====================
// WEB APP DATA (Buyurtma keldi)
// =====================
bot.on("web_app_data", async (ctx) => {
  let orderData;

  try {
    orderData = JSON.parse(ctx.webAppData.data.text());
  } catch (e) {
    return ctx.reply("❌ Ma'lumot noto'g'ri formatda keldi.");
  }

  const { name, amount, product_id } = orderData;
  const userId = ctx.from.id;

  // Orderni Supabase'ga yozish
  const { data: order, error } = await supabase
    .from("orders")
    .insert({
      user_id: userId,
      product_name: name,
      amount: amount,
      product_id: product_id || null,
      status: "pending",
    })
    .select()
    .single();

  if (error) {
    console.error("Order insert error:", error.message);
    return ctx.reply("❌ Buyurtma saqlashda xatolik yuz berdi.");
  }

  const orderId = order.id;

  // Foydalanuvchiga tasdiqlash xabari
  await ctx.reply(
    `✅ Buyurtmangiz qabul qilindi!\n\n📦 Mahsulot: ${name}\n💰 Narxi: ${amount} UZS\n⏳ Holat: Ko'rib chiqilmoqda...\n\nAdmin tasdiqlashi bilan xabar beramiz.`
  );

  // Adminga xabar yuborish
  await bot.telegram.sendMessage(
    ADMIN_ID,
    `🛒 <b>Yangi buyurtma!</b>\n\n` +
      `👤 Sotib oluvchi: <a href="tg://user?id=${userId}">${ctx.from.first_name}</a> (ID: <code>${userId}</code>)\n` +
      `📦 Mahsulot: <b>${name}</b>\n` +
      `💰 Narxi: <b>${amount} UZS</b>\n` +
      `🆔 Order ID: <code>${orderId}</code>`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "✅ Tasdiqlash",
              callback_data: `approve_${orderId}_${userId}`,
            },
            {
              text: "❌ Bekor qilish",
              callback_data: `cancel_${orderId}_${userId}`,
            },
          ],
        ],
      },
    }
  );
});

// =====================
// CALLBACK: TASDIQLASH
// =====================
bot.action(/^approve_(.+)_(\d+)$/, async (ctx) => {
  const orderId = ctx.match[1];
  const userId = ctx.match[2];

  // Supabase'da statusni yangilash
  const { error } = await supabase
    .from("orders")
    .update({ status: "completed" })
    .eq("id", orderId);

  if (error) {
    console.error("Approve update error:", error.message);
    return ctx.answerCbQuery("❌ Xatolik yuz berdi!");
  }

  // Admin xabarini yangilash
  await ctx.editMessageText(
    ctx.callbackQuery.message.text + "\n\n✅ <b>TASDIQLANDI</b>",
    { parse_mode: "HTML" }
  );

  // Foydalanuvchiga xabar
  await bot.telegram.sendMessage(
    userId,
    `✅ <b>Buyurtmangiz tasdiqlandi!</b>\n\n` +
      `Tez orada mahsulotingiz yetkaziladi yoki aktivatsiya qilinadi.\n` +
      `Rahmat! 🙏`,
    { parse_mode: "HTML" }
  );

  await ctx.answerCbQuery("✅ Tasdiqlandi!");
});

// =====================
// CALLBACK: BEKOR QILISH
// =====================
bot.action(/^cancel_(.+)_(\d+)$/, async (ctx) => {
  const orderId = ctx.match[1];
  const userId = ctx.match[2];

  // Supabase'da statusni yangilash
  const { error } = await supabase
    .from("orders")
    .update({ status: "cancelled" })
    .eq("id", orderId);

  if (error) {
    console.error("Cancel update error:", error.message);
    return ctx.answerCbQuery("❌ Xatolik yuz berdi!");
  }

  // Admin xabarini yangilash
  await ctx.editMessageText(
    ctx.callbackQuery.message.text + "\n\n❌ <b>BEKOR QILINDI</b>",
    { parse_mode: "HTML" }
  );

  // Foydalanuvchiga xabar
  await bot.telegram.sendMessage(
    userId,
    `❌ <b>Buyurtmangiz bekor qilindi.</b>\n\n` +
      `Afsuski buyurtmangizni amalga oshirib bo'lmadi.\n` +
      `Savollar bo'lsa admin bilan bog'laning.`,
    { parse_mode: "HTML" }
  );

  await ctx.answerCbQuery("❌ Bekor qilindi!");
});

// =====================
// WEBHOOK ENDPOINT (Vercel)
// =====================
app.post("/api/bot", (req, res) => {
  bot.handleUpdate(req.body, res);
});

// Health check
app.get("/api/bot", (req, res) => {
  res.json({ status: "Bot ishlayapti ✅" });
});

// =====================
// WEBHOOK O'RNATISH (birinchi deploy da bir marta ishlating)
// =====================
// bot.telegram.setWebhook(`${WEBHOOK_URL}`);

module.exports = app;
