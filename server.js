const express = require("express");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

// অন্য ওয়েবসাইট থেকে API request গ্রহণ
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json({ limit: "30kb" }));

// Supabase database connection
let supabase = null;

if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY
  );
}

// Static files
app.use(express.static(path.join(__dirname)));

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Practical Care BD server is running"
  });
});

// Receive and save orders
app.post("/api/orders", async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({
        success: false,
        message: "Order service is not configured yet."
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
        message: "ফর্মের তথ্যগুলো যাচাই করে আবার চেষ্টা করো।"
      });
    }

    const { data, error } = await supabase
      .from("practical_orders")
      .insert([
        {
          customer_name: customerName.trim(),
          phone: phone.trim(),
          class_level: classLevel,
          student_group: studentGroup || null,
          subjects: subjects,
          write_count: writeCount,
          submit_count: submitCount,
          deadline: deadline,
          duration: duration.trim(),
          delivery_method: delivery.trim(),
          area: area || null,

          // পেমেন্ট এখনো যাচাই করা হয়নি
          payment_status: "unverified",
          trx_id: trxId || null,
          details: details || null,
          order_status: "pending"
        }
      ])
      .select("id")
      .single();

    if (error) {
      console.error("Order database operation failed:", error.message);

      return res.status(500).json({
        success: false,
        message:
          "অর্ডার সংরক্ষণ করা যায়নি। পরে আবার চেষ্টা করো।"
      });
    }

    return res.status(201).json({
      success: true,
      orderId: data.id,
      message:
        "অর্ডার গ্রহণ করা হয়েছে। নিশ্চিতকরণ এখনো বাকি।"
    });

  } catch (error) {
    console.error("Order processing failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "সমস্যা হয়েছে। আবার চেষ্টা করো।"
    });
  }
});

// Homepage
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(
    `Practical Care BD server started on port ${PORT}`
  );
});