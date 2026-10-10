const express = require("express");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json({ limit: "30kb" }));

// Render-এর Environment Variables থেকে মান নেওয়া হবে।
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;

if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY
  );
}

// ওয়েবসাইটের index.html পরিবেশন
app.use(express.static(path.join(__dirname)));

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Practical Care BD server is running"
  });
});

// অর্ডার গ্রহণ ও ডেটাবেসে সংরক্ষণ
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
    } = req.body;

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
      typeof duration !== "string" ||
      typeof delivery !== "string" ||
      !["এখনো পেমেন্ট করিনি", "নগদে পেমেন্ট করেছি"].includes(paymentStatus)
    ) {
      return res.status(400).json({
        success: false,
        message: "Please check the order form and try again."
      });
    }

    const { data, error } = await supabase
      .from("practical_orders")
      .insert([{
        customer_name: customerName.trim(),
        phone: phone.trim(),
        class_level: classLevel,
        student_group: studentGroup || null,
        subjects: subjects,
        write_count: writeCount,
        submit_count: submitCount,
        deadline: deadline,
        duration: duration,
        delivery_method: delivery,
        area: area || null,
        payment_status: "unverified",
        trx_id: trxId || null,
        details: details || null,
        order_status: "pending"
      }])
      .select("id")
      .single();

    if (error) {
      console.error("Order database operation failed.");
      return res.status(500).json({
        success: false,
        message: "Order could not be saved. Please contact us."
      });
    }

    return res.status(201).json({
      success: true,
      orderId: data.id,
      message: "Order received and saved. Confirmation is pending."
    });
  } catch (error) {
    console.error("Order processing failed.");
    return res.status(500).json({
      success: false,
      message: "Something went wrong. Please try again."
    });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Practical Care BD server started on port ${PORT}`);
});