const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "30kb" }));
app.use(express.static(__dirname));

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

const adminSessions = new Map();
const SESSION_DURATION = 8 * 60 * 60 * 1000;

app.get("/api/health", (req, res) => {
  res.json({ success: true, message: "Practical Care BD server is running" });
});

app.post("/api/orders", async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ success: false, message: "Order service is not configured." });

    const {
      customerName, phone, classLevel, studentGroup, subjects,
      writeCount, submitCount, deadline, duration, delivery,
      area, paymentStatus, trxId, details
    } = req.body || {};

    if (
      typeof customerName !== "string" || !customerName.trim() ||
      typeof phone !== "string" || !phone.trim() ||
      !["SSC", "HSC"].includes(classLevel) ||
      !Array.isArray(subjects) || !subjects.length ||
      !Number.isInteger(writeCount) || writeCount < 1 ||
      !Number.isInteger(submitCount) || submitCount < 1 ||
      typeof deadline !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(deadline) ||
      Number.isNaN(Date.parse(deadline)) ||
      typeof duration !== "string" || !duration.trim() ||
      typeof delivery !== "string" || !delivery.trim() ||
      !["এখনো পেমেন্ট করিনি", "নগদে পেমেন্ট করেছি"].includes(paymentStatus)
    ) {
      return res.status(400).json({ success: false, message: "ফর্মের তথ্য যাচাই করে আবার চেষ্টা করো।" });
    }

    let data = null;
    let lastError = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      const orderNumber = crypto.randomInt(100000, 1000000);
      const result = await supabase.from("practical_orders").insert([{
        order_number: orderNumber,
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
      }]).select("id, order_number").single();

      if (!result.error) {
        data = result.data;
        break;
      }

      lastError = result.error;
      if (result.error.code !== "23505") break;
    }

    if (!data) {
      console.error("Order save failed:", lastError?.message);
      return res.status(500).json({ success: false, message: "অর্ডার সংরক্ষণ করা যায়নি। আবার চেষ্টা করো।" });
    }

    res.status(201).json({
      success: true,
      orderId: data.id,
      orderNumber: data.order_number,
      orderStatus: "pending",
      message: "অর্ডার গ্রহণ করা হয়েছে। নিশ্চিতকরণ বাকি।"
    });
  } catch (error) {
    console.error("Order error:", error.message);
    res.status(500).json({ success: false, message: "সমস্যা হয়েছে। আবার চেষ্টা করো।" });
  }
});

app.get("/api/orders/status", async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ success: false, message: "Order service is not configured." });

    const orderNumber = String(req.query.orderNumber || "").trim();
    const phone = String(req.query.phone || "").trim();

    if (!/^\d{6}$/.test(orderNumber) || !phone) {
      return res.status(400).json({ success: false, message: "সঠিক Order Number ও ফোন নম্বর দাও।" });
    }

    const { data, error } = await supabase
      .from("practical_orders")
      .select("order_number, order_status, payment_status, created_at")
      .eq("order_number", Number(orderNumber))
      .eq("phone", phone)
      .maybeSingle();

    if (error) {
      console.error("Status lookup failed:", error.message);
      return res.status(500).json({ success: false, message: "স্ট্যাটাস দেখা যাচ্ছে না। পরে চেষ্টা করো।" });
    }

    if (!data) return res.status(404).json({ success: false, message: "Order Number অথবা ফোন নম্বর মিলছে না।" });
    res.json({ success: true, order: data });
  } catch (error) {
    console.error("Status error:", error.message);
    res.status(500).json({ success: false, message: "সমস্যা হয়েছে। আবার চেষ্টা করো।" });
  }
});

app.post("/api/admin/login", (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ success: false, message: "Admin password is not configured." });
  }

  const password = req.body?.password;
  const supplied = Buffer.from(typeof password === "string" ? password : "");
  const expected = Buffer.from(ADMIN_PASSWORD);

  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    return res.status(401).json({ success: false, message: "পাসওয়ার্ড সঠিক নয়।" });
  }

  const token = crypto.randomBytes(32).toString("hex");
  adminSessions.set(token, Date.now() + SESSION_DURATION);
  res.json({ success: true, token });
});

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expiry = adminSessions.get(token);

  if (!token || !expiry || expiry < Date.now()) {
    adminSessions.delete(token);
    return res.status(401).json({ success: false, message: "আবার Admin Login করো।" });
  }
  next();
}

app.get("/api/admin/orders", requireAdmin, async (req, res) => {
  if (!supabase) return res.status(503).json({ success: false, message: "Database is not configured." });

  const { data, error } = await supabase
    .from("practical_orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("Admin orders error:", error.message);
    return res.status(500).json({ success: false, message: "অর্ডার লোড করা যায়নি।" });
  }

  res.json({ success: true, orders: data });
});

app.patch("/api/admin/orders/:id", requireAdmin, async (req, res) => {
  if (!supabase) return res.status(503).json({ success: false, message: "Database is not configured." });

  const id = req.params.id;
  const status = req.body?.status;

  if (!/^\d+$/.test(id) || !["confirmed", "rejected"].includes(status)) {
    return res.status(400).json({ success: false, message: "অর্ডার ID বা স্ট্যাটাস সঠিক নয়।" });
  }

  const { data, error } = await supabase
    .from("practical_orders")
    .update({ order_status: status })
    .eq("id", id)
    .select("id, order_number, order_status")
    .maybeSingle();

  if (error) {
    console.error("Order status error:", error.message);
    return res.status(500).json({ success: false, message: "স্ট্যাটাস পরিবর্তন করা যায়নি।" });
  }

  if (!data) return res.status(404).json({ success: false, message: "অর্ডার পাওয়া যায়নি।" });
  res.json({ success: true, order: data });
});

// Publicly visible published notices.
app.get("/api/notices", async (req, res) => {
  if (!supabase) return res.status(503).json({ success: false, message: "Database is not configured." });

  const { data, error } = await supabase
    .from("practical_notices")
    .select("id, title, message, created_at")
    .eq("is_published", true)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Notices load error:", error.message);
    return res.status(500).json({ success: false, message: "নোটিশ লোড করা যায়নি।" });
  }

  res.json({ success: true, notices: data });
});

// Admin views all notices.
app.get("/api/admin/notices", requireAdmin, async (req, res) => {
  if (!supabase) return res.status(503).json({ success: false, message: "Database is not configured." });

  const { data, error } = await supabase
    .from("practical_notices")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Admin notices error:", error.message);
    return res.status(500).json({ success: false, message: "নোটিশ লোড করা যায়নি।" });
  }

  res.json({ success: true, notices: data });
});

// Admin creates a notice.
app.post("/api/admin/notices", requireAdmin, async (req, res) => {
  if (!supabase) return res.status(503).json({ success: false, message: "Database is not configured." });

  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  const isPublished = req.body?.is_published === true;

  if (!title || !message || title.length > 200 || message.length > 5000) {
    return res.status(400).json({ success: false, message: "শিরোনাম ও নোটিশ লিখো (শিরোনাম সর্বোচ্চ ২০০, বার্তা ৫০০০ অক্ষর)।" });
  }

  const { data, error } = await supabase
    .from("practical_notices")
    .insert([{ title, message, is_published: isPublished }])
    .select("*")
    .single();

  if (error) {
    console.error("Notice create error:", error.message);
    return res.status(500).json({ success: false, message: "নোটিশ সংরক্ষণ করা যায়নি।" });
  }

  res.status(201).json({ success: true, notice: data });
});

// Admin publishes/unpublishes a notice.
app.patch("/api/admin/notices/:id", requireAdmin, async (req, res) => {
  if (!supabase) return res.status(503).json({ success: false, message: "Database is not configured." });

  const id = req.params.id;
  const updates = {};

  if (typeof req.body?.is_published === "boolean") {
    updates.is_published = req.body.is_published;
  }

  if (typeof req.body?.title === "string" && req.body.title.trim()) {
    updates.title = req.body.title.trim();
  }

  if (typeof req.body?.message === "string" && req.body.message.trim()) {
    updates.message = req.body.message.trim();
  }

  if (!/^\d+$/.test(id) || !Object.keys(updates).length) {
    return res.status(400).json({ success: false, message: "নোটিশের তথ্য সঠিক নয়।" });
  }

  const { data, error } = await supabase
    .from("practical_notices")
    .update(updates)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("Notice update error:", error.message);
    return res.status(500).json({ success: false, message: "নোটিশ আপডেট করা যায়নি।" });
  }

  if (!data) return res.status(404).json({ success: false, message: "নোটিশ পাওয়া যায়নি।" });
  res.json({ success: true, notice: data });
});

// Admin deletes a notice.
app.delete("/api/admin/notices/:id", requireAdmin, async (req, res) => {
  if (!supabase) return res.status(503).json({ success: false, message: "Database is not configured." });

  const id = req.params.id;
  if (!/^\d+$/.test(id)) {
    return res.status(400).json({ success: false, message: "নোটিশ ID সঠিক নয়।" });
  }

  const { data, error } = await supabase
    .from("practical_notices")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Notice delete error:", error.message);
    return res.status(500).json({ success: false, message: "নোটিশ ডিলিট করা যায়নি।" });
  }

  if (!data) return res.status(404).json({ success: false, message: "নোটিশ পাওয়া যায়নি।" });
  res.json({ success: true, message: "নোটিশ ডিলিট করা হয়েছে।" });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Practical Care BD server running on ${PORT}`);
});