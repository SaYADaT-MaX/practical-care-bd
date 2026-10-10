const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PATCH, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json({ limit: "30kb" }));
app.use(express.static(__dirname));

let supabase = null;

if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY
  );
}

// Temporary admin sessions; expire after 8 hours.
const adminSessions = new Map();
const SESSION_DURATION = 8 * 60 * 60 * 1000;

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Practical Care BD server is running"
  });
});

// Customer order submission
app.post("/api/orders", async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({
        success: false,
        message: "Order service is not configured."
      });
    }

    const {
      customerName,
      phone,
      classLevel,
      studentGroup,
      subjects,
      writeCount,
      submitCount,
      deadline,
      duration,
      delivery,
      area,
      paymentStatus,
      trxId,
      details
    } = req.body || {};

    if (
      typeof customerName !== "string" ||
      !customerName.trim() ||
      typeof phone !== "string" ||
      !phone.trim() ||
      !["SSC", "HSC"].includes(classLevel) ||
      !Array.isArray(subjects) ||
      subjects.length === 0 ||
      !Number.isInteger(writeCount) ||
      writeCount < 1 ||
      !Number.isInteger(submitCount) ||
      submitCount < 1 ||
      typeof deadline !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(deadline) ||
      Number.isNaN(Date.parse(deadline)) ||
      typeof duration !== "string" ||
      !duration.trim() ||
      typeof delivery !== "string" ||
      !delivery.trim() ||
      ![
        "এখনো পেমেন্ট করিনি",
        "নগদে পেমেন্ট করেছি"
      ].includes(paymentStatus)
    ) {
      return res.status(400).json({
        success: false,
        message: "ফর্মের তথ্য যাচাই করে আবার চেষ্টা করো।"
      });
    }

    const { data, error } = await supabase
      .from("practical_orders")
      .insert([{
        customer_name: customerName.trim(),
        phone: phone.trim(),
        class_level: classLevel,
        student_group: studentGroup || null,
        subjects,
        write_count: writeCount,
        submit_count: submitCount,
        deadline,
        duration: duration.trim(),
        delivery_method: delivery.trim(),
        area: area || null,
        payment_status: "unverified",
        trx_id: trxId || null,
        details: details || null,
        order_status: "pending"
      }])
      .select("id")
      .single();

    if (error) {
      console.error("Order save failed:", error.message);
      return res.status(500).json({
        success: false,
        message: "অর্ডার সংরক্ষণ করা যায়নি।"
      });
    }

    return res.status(201).json({
      success: true,
      orderId: data.id,
      message: "অর্ডার গ্রহণ করা হয়েছে। নিশ্চিতকরণ বাকি।"
    });
  } catch (error) {
    console.error("Order error:", error.message);
    return res.status(500).json({
      success: false,
      message: "সমস্যা হয়েছে। আবার চেষ্টা করো।"
    });
  }
});

// Admin login
app.post("/api/admin/login", (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({
      success: false,
      message: "Admin password is not configured."
    });
  }

  const password = req.body?.password;

  if (
    typeof password !== "string" ||
    password.length !== ADMIN_PASSWORD.length ||
    !crypto.timingSafeEqual(
      Buffer.from(password),
      Buffer.from(ADMIN_PASSWORD)
    )
  ) {
    return res.status(401).json({
      success: false,
      message: "পাসওয়ার্ড সঠিক নয়।"
    });
  }

  const token = crypto.randomBytes(32).toString("hex");
  adminSessions.set(token, Date.now() + SESSION_DURATION);

  res.json({ success: true, token });
});

// Protect all admin API routes below
function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : "";

  const expiry = adminSessions.get(token);

  if (!token || !expiry || expiry < Date.now()) {
    adminSessions.delete(token);
    return res.status(401).json({
      success: false,
      message: "আবার Admin Login করো।"
    });
  }

  next();
}

// View orders
app.get("/api/admin/orders", requireAdmin, async (req, res) => {
  if (!supabase) {
    return res.status(503).json({
      success: false,
      message: "Database is not configured."
    });
  }

  const { data, error } = await supabase
    .from("practical_orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("Admin orders error:", error.message);
    return res.status(500).json({
      success: false,
      message: "অর্ডার লোড করা যায়নি।"
    });
  }

  res.json({ success: true, orders: data });
});

// Confirm or reject an order
app.patch(
  "/api/admin/orders/:id",
  requireAdmin,
  async (req, res) => {
    if (!supabase) {
      return res.status(503).json({
        success: false,
        message: "Database is not configured."
      });
    }

    const id = req.params.id;
    const status = req.body?.status;

    if (!/^\d+$/.test(id) ||
        !["confirmed", "rejected"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "অর্ডার ID বা স্ট্যাটাস সঠিক নয়।"
      });
    }

    const { data, error } = await supabase
      .from("practical_orders")
      .update({ order_status: status })
      .eq("id", id)
      .select("id, order_status")
      .maybeSingle();

    if (error) {
      console.error("Order status error:", error.message);
      return res.status(500).json({
        success: false,
        message: "স্ট্যাটাস পরিবর্তন করা যায়নি।"
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "অর্ডার পাওয়া যায়নি।"
      });
    }

    res.json({ success: true, order: data });
  }
);

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Practical Care BD server running on ${PORT}`);
});