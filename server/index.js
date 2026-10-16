import "dotenv/config";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Razorpay from "razorpay";
import validator from "validator";

const app = express();
const port = Number(process.env.PORT) || 5000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sessionCookieName = "slidecraft_session";
const sessionDurationMs = 7 * 24 * 60 * 60 * 1000;
const quarterlyDurationMs = 90 * 24 * 60 * 60 * 1000;
const monthlyPlanKey = "monthly";
const quarterlyPlanKey = "quarterly";
const freeExportLimit = 3;
const monthlyAmountPaise = 30000;
const quarterlyAmountPaise = 50000;
let razorpayClient;

app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://checkout.razorpay.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "https://generativelanguage.googleapis.com", "https://api.razorpay.com", "https://checkout.razorpay.com"],
        frameSrc: ["'self'", "https://api.razorpay.com", "https://checkout.razorpay.com"],
        formAction: ["'self'", "https://api.razorpay.com", "https://checkout.razorpay.com"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  }),
);
app.use(express.json({
  limit: "16kb",
  strict: true,
  verify: (req, _res, buffer) => {
    req.rawBody = Buffer.from(buffer);
  },
}));
app.use(cookieParser());

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    freePdfExportsUsed: { type: Number, default: 0, min: 0 },
    paidAccessUntil: { type: Date, default: null },
  },
  { timestamps: true },
);
const User = mongoose.models.User || mongoose.model("User", userSchema);

const billingSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    planKey: { type: String, enum: [monthlyPlanKey, quarterlyPlanKey], required: true },
    status: {
      type: String,
      enum: ["pending", "authorized", "active", "cancelled", "failed", "expired"],
      default: "pending",
    },
    razorpayOrderId: { type: String, unique: true, sparse: true },
    razorpaySubscriptionId: { type: String, unique: true, sparse: true },
    paymentIds: { type: [String], default: [] },
    accessUntil: { type: Date, default: null },
    cancelAtCycleEnd: { type: Boolean, default: false },
  },
  { timestamps: true },
);
const Billing = mongoose.models.Billing || mongoose.model("Billing", billingSchema);

if (process.env.MONGODB_URI) {
  mongoose
    .connect(process.env.MONGODB_URI)
    .then(() => console.log("MongoDB connected."))
    .catch((error) => console.error("MongoDB connection failed:", error.message));
}

function authConfigurationError() {
  if (mongoose.connection.readyState !== 1) return "Sign-in is unavailable until MongoDB is connected.";
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    return "Sign-in is not configured. Set JWT_SECRET to a random value of at least 32 characters.";
  }
  return null;
}

function setSessionCookie(res, userId) {
  const token = jwt.sign({ sub: userId }, process.env.JWT_SECRET, {
    algorithm: "HS256",
    audience: "slidecraft-web",
    expiresIn: "7d",
    issuer: "slidecraft",
  });
  res.cookie(sessionCookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: sessionDurationMs,
    path: "/",
  });
}

function clearSessionCookie(res) {
  res.clearCookie(sessionCookieName, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });
}

async function getSessionUser(token) {
  const payload = jwt.verify(token, process.env.JWT_SECRET, {
    algorithms: ["HS256"],
    audience: "slidecraft-web",
    issuer: "slidecraft",
  });
  return User.findById(payload.sub);
}

async function requireAuth(req, res, next) {
  const token = req.cookies[sessionCookieName];
  if (!token) return res.status(401).json({ error: "Sign in to generate a presentation." });

  const configurationError = authConfigurationError();
  if (configurationError) return res.status(503).json({ error: configurationError });

  try {
    const user = await getSessionUser(token);
    if (!user) {
      clearSessionCookie(res);
      return res.status(401).json({ error: "Your session has expired. Please sign in again." });
    }
    req.authenticatedUser = user;
    return next();
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      clearSessionCookie(res);
      return res.status(401).json({ error: "Your session has expired. Please sign in again." });
    }
    console.error("Session authentication failed:", error.message);
    return res.status(500).json({ error: "Could not verify your session." });
  }
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

function paymentConfiguration() {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    return { error: "Razorpay is not configured. Add your test or live key ID and secret to the server .env file." };
  }
  return { error: null };
}

function getRazorpayClient() {
  const configuration = paymentConfiguration();
  if (configuration.error) throw new Error(configuration.error);
  if (!razorpayClient) {
    razorpayClient = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return razorpayClient;
}

function hasValidSignature(message, signature, secret) {
  if (typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(message).digest();
  const actual = Buffer.from(signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function billingStatusForUser(user, paymentReady) {
  const activePlan = user.paidAccessUntil && user.paidAccessUntil > new Date();
  return {
    freePdfAvailable: (user.freePdfExportsUsed || 0) < freeExportLimit,
    freeExportsRemaining: Math.max(0, freeExportLimit - (user.freePdfExportsUsed || 0)),
    paidAccess: Boolean(activePlan),
    accessUntil: activePlan ? user.paidAccessUntil : null,
    paymentReady,
    monthlyPlanReady: Boolean(process.env.RAZORPAY_MONTHLY_PLAN_ID),
    monthlyAmountPaise,
    quarterlyAmountPaise,
    currency: "INR",
  };
}

function amountForPlan(planKey) {
  return planKey === monthlyPlanKey ? monthlyAmountPaise : quarterlyAmountPaise;
}

async function addPaidAccess(userId, until) {
  if (!Number.isFinite(until) || until <= Date.now()) return;
  await User.updateOne(
    { _id: userId, $or: [{ paidAccessUntil: null }, { paidAccessUntil: { $lt: new Date(until) } }] },
    { $set: { paidAccessUntil: new Date(until) } },
  );
}

async function applySubscriptionCharge(billing, subscription, paymentId) {
  const periodEndSeconds = Number(subscription.current_end);
  const accessUntil = periodEndSeconds > 0 ? new Date(periodEndSeconds * 1000) : null;
  const paymentAlreadyApplied = billing.paymentIds.includes(paymentId);
  billing.status = subscription.status === "cancelled" ? "cancelled" : "active";
  billing.cancelAtCycleEnd = subscription.status === "cancelled";
  billing.accessUntil = accessUntil || billing.accessUntil;
  if (!paymentAlreadyApplied) billing.paymentIds.push(paymentId);
  await billing.save();
  if (billing.accessUntil) await addPaidAccess(billing.user, billing.accessUntil.getTime());
}

const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many registration attempts. Please try again later." },
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Please try again later." },
});
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many checkout attempts. Please try again later." },
});
const exportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many export attempts. Please try again later." },
});

const slideIdeas = [
  {
    title: "Start with the big picture",
    angle: "Set the scene and explain why this topic matters right now.",
    points: ["Define the central idea", "Share the context", "Give the audience a reason to care"],
  },
  {
    title: "The essential building blocks",
    angle: "Break the topic into its most important parts.",
    points: ["Identify the key components", "Show how they connect", "Make each idea easy to remember"],
  },
  {
    title: "What the evidence tells us",
    angle: "Explore useful examples, research, or real-world signals.",
    points: ["Look for reliable evidence", "Compare different perspectives", "Separate facts from assumptions"],
  },
  {
    title: "Put the idea into action",
    angle: "Turn the main concepts into clear, practical next steps.",
    points: ["Choose one achievable action", "Decide what success looks like", "Learn and adjust as you go"],
  },
  {
    title: "A fresh perspective",
    angle: "Consider challenges and opportunities people often overlook.",
    points: ["Question common assumptions", "Notice potential trade-offs", "Look for an unexpected opportunity"],
  },
  {
    title: "The takeaway",
    angle: "Bring the story together and leave the audience with one clear thought.",
    points: ["Recap the most useful insight", "Connect it to the audience", "End with a memorable next step"],
  },
];

function makeLocalSlides({ topic, audience, slideCount, style }) {
  const normalizedTopic = topic.trim();
  return Array.from({ length: slideCount }, (_, index) => {
    const idea = slideIdeas[index % slideIdeas.length];
    const isOpening = index === 0;
    const isClosing = index === slideCount - 1 && slideCount > 1;
    const title = isOpening
      ? `A fresh look at ${normalizedTopic}`
      : isClosing
        ? `What to remember about ${normalizedTopic}`
        : `${idea.title}: ${normalizedTopic}`;

    return {
      title,
      subtitle: isOpening ? `A ${style.toLowerCase()} guide for ${audience.toLowerCase()}` : idea.angle,
      bullets: isOpening
        ? [
            `What ${normalizedTopic} means in everyday terms`,
            `Why it matters to ${audience.toLowerCase()}`,
            "The key ideas you will take away",
          ]
        : idea.points.map((point) => `${point} through the lens of ${normalizedTopic}`),
      speakerNotes: `Introduce ${normalizedTopic} in a way that feels relevant to ${audience.toLowerCase()}. ${idea.angle} Use a specific example that the audience will recognize, and keep the focus on one main message.`,
    };
  });
}

function extractJson(text) {
  const cleaned = text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("The AI response did not contain valid JSON.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function generateWithGemini(options) {
  const prompt = `Create a polished presentation as JSON only, with this exact shape:
{"title":"presentation title","slides":[{"title":"slide title","subtitle":"one short supporting line","bullets":["concise point","concise point","concise point"],"speakerNotes":"natural presenter notes"}]}
Topic: ${options.topic}
Audience: ${options.audience}
Number of slides: exactly ${options.slideCount}
Visual style: ${options.style}
Talk duration: ${options.duration} minutes
Requirements: Make each slide specific, accurate, engaging, and appropriate for the audience. Keep bullets short. Make a coherent beginning, middle, and ending. Do not invent statistics or citations.`;

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.7 },
      }),
    },
  );

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const message = errorBody.error?.message || `Gemini request failed (${response.status}).`;
    throw new Error(message);
  }

  const result = await response.json();
  const text = result.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
  if (!text) throw new Error("Gemini returned an empty response.");

  const deck = extractJson(text);
  if (!Array.isArray(deck.slides) || deck.slides.length !== options.slideCount) {
    throw new Error("Gemini returned an unexpected number of slides. Please try again.");
  }
  return deck;
}

app.get("/api/health", (_req, res) => {
  const mongoConnected = mongoose.connection.readyState === 1;
  const jwtConfigured = Boolean(process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32);
  const mongoUriConfigured = Boolean(process.env.MONGODB_URI);
  const razorpayConfigured = Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
  res.json({
    status: "ok",
    aiEnabled: Boolean(process.env.GEMINI_API_KEY),
    authEnabled: mongoConnected && jwtConfigured,
    mongoConnected,
    mongoUriConfigured,
    jwtConfigured,
    paymentReady: razorpayConfigured,
    monthlyPlanReady: Boolean(process.env.RAZORPAY_MONTHLY_PLAN_ID && process.env.RAZORPAY_WEBHOOK_SECRET),
  });
});

app.post("/api/auth/register", registrationLimiter, async (req, res) => {
  const { name, email, password } = req.body ?? {};
  const normalizedName = typeof name === "string" ? name.normalize("NFKC").trim() : "";
  if (
    normalizedName.length < 1 ||
    normalizedName.length > 80 ||
    !/^[\p{L}\p{M}][\p{L}\p{M}\p{N} .'-]*$/u.test(normalizedName)
  ) {
    return res.status(400).json({ error: "Name must be 1-80 characters and contain only letters, numbers, spaces, apostrophes, periods, or hyphens." });
  }
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (
    normalizedEmail.length > 254 ||
    !validator.isEmail(normalizedEmail, { allow_utf8_local_part: false, require_tld: true })
  ) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }
  if (typeof password !== "string" || password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
    return res.status(400).json({ error: "Password must be at least 12 characters and no more than 72 UTF-8 bytes." });
  }
  const configurationError = authConfigurationError();
  if (configurationError) return res.status(503).json({ error: configurationError });

  try {
    const existingUser = await User.exists({ email: normalizedEmail });
    if (existingUser) return res.status(409).json({ error: "An account with that email already exists." });

    const user = await User.create({
      name: normalizedName,
      email: normalizedEmail,
      passwordHash: await bcrypt.hash(password, 12),
    });
    setSessionCookie(res, user.id);
    return res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: "An account with that email already exists." });
    console.error("Account registration failed:", error.message);
    return res.status(500).json({ error: "Could not create your account. Please try again." });
  }
});

app.post("/api/auth/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body ?? {};
  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    email.length > 254 ||
    password.length === 0 ||
    Buffer.byteLength(password, "utf8") > 72 ||
    !validator.isEmail(email.trim(), { allow_utf8_local_part: false, require_tld: true })
  ) {
    return res.status(400).json({ error: "Enter a valid email and password." });
  }
  const configurationError = authConfigurationError();
  if (configurationError) return res.status(503).json({ error: configurationError });

  try {
    const user = await User.findOne({ email: email.trim().toLowerCase() }).select("+passwordHash");
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: "Email or password is incorrect." });
    }
    setSessionCookie(res, user.id);
    return res.json({ user: publicUser(user) });
  } catch (error) {
    console.error("Account sign-in failed:", error.message);
    return res.status(500).json({ error: "Could not sign in. Please try again." });
  }
});

app.get("/api/auth/me", async (req, res) => {
  const configurationError = authConfigurationError();
  if (configurationError) return res.status(503).json({ error: configurationError });
  const token = req.cookies[sessionCookieName];
  if (!token) return res.json({ user: null });

  try {
    const user = await getSessionUser(token);
    if (!user) {
      clearSessionCookie(res);
      return res.json({ user: null });
    }
    return res.json({ user: publicUser(user) });
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      clearSessionCookie(res);
      return res.json({ user: null });
    }
    console.error("Session lookup failed:", error.message);
    return res.status(500).json({ error: "Could not check your sign-in status." });
  }
});

app.post("/api/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  return res.json({ ok: true });
});

app.get("/api/billing/status", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.authenticatedUser.id);
    if (!user) return res.status(401).json({ error: "Your account could not be found. Please sign in again." });
    const latestBilling = await Billing.findOne({ user: user.id }).sort({ createdAt: -1 }).lean();
    return res.json({
      ...billingStatusForUser(
        user,
        Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
      ),
      monthlyPlanReady: Boolean(process.env.RAZORPAY_MONTHLY_PLAN_ID && process.env.RAZORPAY_WEBHOOK_SECRET),
      latestPlan: latestBilling
        ? {
            planKey: latestBilling.planKey,
            status: latestBilling.status,
            accessUntil: latestBilling.accessUntil,
            cancelAtCycleEnd: latestBilling.cancelAtCycleEnd,
          }
        : null,
    });
  } catch (error) {
    console.error("Billing status lookup failed:", error.message);
    return res.status(500).json({ error: "Could not load billing status." });
  }
});

app.post("/api/billing/checkout", requireAuth, checkoutLimiter, async (req, res) => {
  const { planKey } = req.body ?? {};
  if (planKey !== monthlyPlanKey && planKey !== quarterlyPlanKey) {
    return res.status(400).json({ error: "Choose a valid subscription plan." });
  }
  const config = paymentConfiguration();
  if (config.error) return res.status(503).json({ error: config.error });
  if (planKey === monthlyPlanKey && (!process.env.RAZORPAY_MONTHLY_PLAN_ID || !process.env.RAZORPAY_WEBHOOK_SECRET)) {
    return res.status(503).json({
      error: "The monthly Razorpay plan is not configured. Create the ₹300/month plan in Razorpay and set RAZORPAY_MONTHLY_PLAN_ID.",
    });
  }

  let billing;
  try {
    const razorpay = getRazorpayClient();
    billing = await Billing.create({ user: req.authenticatedUser.id, planKey, status: "pending" });

    if (planKey === monthlyPlanKey) {
      const subscription = await razorpay.subscriptions.create({
        plan_id: process.env.RAZORPAY_MONTHLY_PLAN_ID,
        total_count: 120,
        customer_notify: 1,
        notes: { slidecraft_billing_id: String(billing.id), slidecraft_user_id: String(req.authenticatedUser.id) },
      });
      billing.razorpaySubscriptionId = subscription.id;
      await billing.save();
      return res.status(201).json({
        billingId: billing.id,
        checkout: {
          kind: "subscription",
          keyId: process.env.RAZORPAY_KEY_ID,
          subscriptionId: subscription.id,
          amount: monthlyAmountPaise,
          currency: "INR",
          name: "Slidecraft",
          description: "Monthly PDF export subscription",
          prefill: { name: req.authenticatedUser.name, email: req.authenticatedUser.email },
        },
      });
    }

    const order = await razorpay.orders.create({
      amount: quarterlyAmountPaise,
      currency: "INR",
      receipt: `sc_${randomUUID().replace(/-/g, "").slice(0, 32)}`,
      notes: { slidecraft_billing_id: String(billing.id), slidecraft_user_id: String(req.authenticatedUser.id) },
    });
    billing.razorpayOrderId = order.id;
    await billing.save();
    return res.status(201).json({
      billingId: billing.id,
      checkout: {
        kind: "order",
        keyId: process.env.RAZORPAY_KEY_ID,
        orderId: order.id,
        amount: quarterlyAmountPaise,
        currency: "INR",
        name: "Slidecraft",
        description: "90-day PDF export pass",
        prefill: { name: req.authenticatedUser.name, email: req.authenticatedUser.email },
      },
    });
  } catch (error) {
    if (billing) {
      await Billing.updateOne({ _id: billing.id, status: "pending" }, { $set: { status: "failed" } }).catch((updateError) => {
        console.error("Could not mark failed checkout:", updateError.message);
      });
    }
    console.error("Razorpay checkout creation failed:", error.message);
    return res.status(502).json({ error: "Could not start checkout with Razorpay. Please try again." });
  }
});

app.post("/api/billing/verify", requireAuth, checkoutLimiter, async (req, res) => {
  const { billingId, paymentId, signature } = req.body ?? {};
  if (
    typeof billingId !== "string" ||
    !mongoose.isValidObjectId(billingId) ||
    typeof paymentId !== "string" ||
    paymentId.length > 100 ||
    typeof signature !== "string"
  ) {
    return res.status(400).json({ error: "Payment verification details are invalid." });
  }

  try {
    const billing = await Billing.findOne({ _id: billingId, user: req.authenticatedUser.id });
    if (!billing) return res.status(404).json({ error: "Checkout session was not found." });
    const razorpay = getRazorpayClient();

    if (billing.planKey === quarterlyPlanKey) {
      if (!billing.razorpayOrderId || !hasValidSignature(
        `${billing.razorpayOrderId}|${paymentId}`,
        signature,
        process.env.RAZORPAY_KEY_SECRET,
      )) {
        return res.status(400).json({ error: "Razorpay payment signature could not be verified." });
      }
      const payment = await razorpay.payments.fetch(paymentId);
      if (payment.order_id !== billing.razorpayOrderId || payment.status !== "captured") {
        return res.status(400).json({ error: "Razorpay has not confirmed this payment as captured." });
      }
      if (billing.status !== "active") {
        const updatedBilling = await Billing.findOneAndUpdate(
          { _id: billing.id, user: req.authenticatedUser.id, status: "pending" },
          { $set: { status: "active", accessUntil: null }, $addToSet: { paymentIds: paymentId } },
          { new: true },
        );
        if (updatedBilling) {
          const now = new Date();
          await User.updateOne(
            { _id: req.authenticatedUser.id },
            [{
              $set: {
                paidAccessUntil: {
                  $add: [
                    { $max: [{ $ifNull: ["$paidAccessUntil", now] }, now] },
                    quarterlyDurationMs,
                  ],
                },
              },
            }],
          );
          const updatedUser = await User.findById(req.authenticatedUser.id);
          updatedBilling.accessUntil = updatedUser?.paidAccessUntil || null;
          await updatedBilling.save();
        }
      }
      const finalBilling = await Billing.findById(billing.id);
      const user = await User.findById(req.authenticatedUser.id);
      return res.json({
        verified: true,
        status: finalBilling?.status || "pending",
        ...billingStatusForUser(user, Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)),
      });
    }

    if (!billing.razorpaySubscriptionId || !hasValidSignature(
      `${paymentId}|${billing.razorpaySubscriptionId}`,
      signature,
      process.env.RAZORPAY_KEY_SECRET,
    )) {
      return res.status(400).json({ error: "Razorpay subscription signature could not be verified." });
    }
    const payment = await razorpay.payments.fetch(paymentId);
    if (payment.subscription_id !== billing.razorpaySubscriptionId) {
      return res.status(400).json({ error: "The payment is not linked to this subscription." });
    }
    billing.status = billing.status === "pending" ? "authorized" : billing.status;
    if (!billing.paymentIds.includes(paymentId)) billing.paymentIds.push(paymentId);
    await billing.save();

    const subscription = await razorpay.subscriptions.fetch(billing.razorpaySubscriptionId);
    if (payment.status === "captured" && subscription.status === "active" && Number(subscription.current_end) > 0) {
      await applySubscriptionCharge(billing, subscription, paymentId);
    }
    const user = await User.findById(req.authenticatedUser.id);
    return res.json({
      verified: true,
      status: billing.status,
      message: billing.status === "active"
        ? "Your monthly plan is active."
        : "Razorpay verified the subscription. Access will activate when Razorpay confirms the first charge.",
      ...billingStatusForUser(user, Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)),
    });
  } catch (error) {
    console.error("Razorpay payment verification failed:", error.message);
    return res.status(502).json({ error: "Could not verify the Razorpay payment. Please contact support if you were charged." });
  }
});

app.post("/api/billing/cancel", requireAuth, checkoutLimiter, async (req, res) => {
  try {
    const billing = await Billing.findOne({
      user: req.authenticatedUser.id,
      planKey: monthlyPlanKey,
      status: { $in: ["active", "authorized"] },
      cancelAtCycleEnd: false,
    }).sort({ createdAt: -1 });
    if (!billing?.razorpaySubscriptionId) return res.status(404).json({ error: "No active monthly subscription was found." });

    const subscription = await getRazorpayClient().subscriptions.cancel(billing.razorpaySubscriptionId, true);
    billing.cancelAtCycleEnd = true;
    if (subscription.current_end) billing.accessUntil = new Date(subscription.current_end * 1000);
    await billing.save();
    if (billing.accessUntil) await addPaidAccess(req.authenticatedUser.id, billing.accessUntil.getTime());
    return res.json({
      ok: true,
      cancelAtCycleEnd: true,
      accessUntil: billing.accessUntil,
      message: "Cancellation is scheduled. Your paid access remains available through the current billing period.",
    });
  } catch (error) {
    console.error("Razorpay subscription cancellation failed:", error.message);
    return res.status(502).json({ error: "Could not schedule subscription cancellation. Please try again." });
  }
});

app.post("/api/billing/webhook", async (req, res) => {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) return res.status(503).json({ error: "Razorpay webhook is not configured." });
  const signature = req.get("x-razorpay-signature");
  if (!req.rawBody || !hasValidSignature(req.rawBody.toString("utf8"), signature, webhookSecret)) {
    return res.status(400).json({ error: "Razorpay webhook signature could not be verified." });
  }

  try {
    const event = req.body?.event;
    const payload = req.body?.payload;
    const subscription = payload?.subscription?.entity;
    const payment = payload?.payment?.entity;
    if (!subscription?.id) return res.status(200).json({ received: true });

    const billing = await Billing.findOne({ razorpaySubscriptionId: subscription.id });
    if (!billing) return res.status(200).json({ received: true });

    if (event === "subscription.charged" && payment?.id) {
      await applySubscriptionCharge(billing, subscription, payment.id);
    } else if (event === "subscription.cancelled") {
      billing.status = "cancelled";
      billing.cancelAtCycleEnd = true;
      if (Number(subscription.current_end) > 0) {
        billing.accessUntil = new Date(Number(subscription.current_end) * 1000);
        await addPaidAccess(billing.user, billing.accessUntil.getTime());
      }
      await billing.save();
    } else if (event === "subscription.halted") {
      billing.status = "failed";
      await billing.save();
    } else if (event === "subscription.activated" && billing.status === "pending") {
      billing.status = "authorized";
      await billing.save();
    }
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Razorpay webhook processing failed:", error.message);
    return res.status(500).json({ error: "Could not process Razorpay webhook." });
  }
});

app.post("/api/billing/consume-export", requireAuth, exportLimiter, async (req, res) => {
  try {
    const userId = req.authenticatedUser.id;
    const now = new Date();
    const user = await User.findById(userId);
    if (!user) return res.status(401).json({ error: "Your account could not be found. Please sign in again." });
    if (user.paidAccessUntil && user.paidAccessUntil > now) {
      return res.json({ allowed: true, paidAccess: true, accessUntil: user.paidAccessUntil });
    }

    const freeExport = await User.findOneAndUpdate(
      {
        _id: userId,
        freePdfExportsUsed: { $lt: freeExportLimit },
        $or: [{ paidAccessUntil: null }, { paidAccessUntil: { $lte: now } }],
      },
      { $inc: { freePdfExportsUsed: 1 } },
      { new: true },
    );
    if (freeExport) {
      return res.json({ allowed: true, paidAccess: false, freeExportConsumed: true });
    }

    const latestUser = await User.findById(userId);
    if (latestUser?.paidAccessUntil && latestUser.paidAccessUntil > now) {
      return res.json({ allowed: true, paidAccess: true, accessUntil: latestUser.paidAccessUntil });
    }
    return res.status(402).json({
      error: "Your 3 free PDF exports have been used. Choose a plan to export another presentation.",
      ...billingStatusForUser(latestUser, Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && process.env.RAZORPAY_WEBHOOK_SECRET)),
      monthlyPlanReady: Boolean(process.env.RAZORPAY_MONTHLY_PLAN_ID && process.env.RAZORPAY_WEBHOOK_SECRET),
    });
  } catch (error) {
    console.error("PDF export entitlement check failed:", error.message);
    return res.status(500).json({ error: "Could not verify your PDF export access." });
  }
});

app.post("/api/generate", requireAuth, async (req, res) => {
  const { topic, audience, slideCount, style, duration } = req.body ?? {};
  if (typeof topic !== "string" || topic.trim().length < 2 || topic.trim().length > 160) {
    return res.status(400).json({ error: "Topic must be between 2 and 160 characters." });
  }
  if (typeof audience !== "string" || audience.trim().length < 2 || audience.length > 100) {
    return res.status(400).json({ error: "Please choose a valid audience." });
  }
  if (!Number.isInteger(slideCount) || slideCount < 3 || slideCount > 5) {
    return res.status(400).json({ error: "Slide count must be between 3 and 5." });
  }
  if (typeof style !== "string" || style.length > 50) {
    return res.status(400).json({ error: "Please choose a valid presentation style." });
  }
  if (!Number.isInteger(duration) || duration < 1 || duration > 90) {
    return res.status(400).json({ error: "Talk duration must be between 1 and 90 minutes." });
  }

  const options = { topic: topic.trim(), audience: audience.trim(), slideCount, style, duration };
  try {
    if (process.env.GEMINI_API_KEY) {
      const deck = await generateWithGemini(options);
      return res.json({ ...deck, mode: "ai" });
    }
    return res.json({
      title: `${options.topic}: a presentation`,
      slides: makeLocalSlides(options),
      mode: "local",
    });
  } catch (error) {
    console.error("Presentation generation failed:", error.message);
    return res.status(502).json({ error: `Could not generate slides: ${error.message}` });
  }
});

app.use((error, _req, res, next) => {
  if (error.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body is too large." });
  }
  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({ error: "Request body must be valid JSON." });
  }
  console.error("Unhandled request error:", error.message);
  return res.status(500).json({ error: "An unexpected server error occurred." });
});

if (process.env.NODE_ENV === "production") {
  const clientDist = path.resolve(__dirname, "../client/dist");
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
}

app.listen(port, () => {
  console.log(`Slide Generator API listening at http://localhost:${port}`);
});
