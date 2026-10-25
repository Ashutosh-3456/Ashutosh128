import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";
import twilio from "twilio";

import {
  processMedicalDocument,
} from "./ocrService_sarvam_Aayuvora_updated.js";

dotenv.config();

const app = express();

const PORT = Number(process.env.PORT || 3001);
// ============================================================
// MIDDLEWARE
// ============================================================

app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(
  express.json({
    limit: "30mb",
  })
);
// ============================================================
// SOS AMBULANCE
// Get patient's GPS coordinates and convert them to an address
// ============================================================

app.post("/api/sos/ambulance", async (req, res) => {
  try {
    const {
      latitude,
      longitude,
      patientId,
      patientName,
    } = req.body || {};

    console.log("========================================");
    console.log("🚨 SOS AMBULANCE REQUEST RECEIVED");
    console.log("========================================");

    console.log("Patient ID:", patientId || "Not provided");
    console.log("Patient Name:", patientName || "Not provided");
    console.log("Latitude:", latitude);
    console.log("Longitude:", longitude);

    // ----------------------------------------------------------
    // Validate location
    // ----------------------------------------------------------

    const lat = Number(latitude);
    const lon = Number(longitude);

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon)
    ) {
      console.error(
        "❌ Invalid coordinates received"
      );

      return res.status(400).json({
        success: false,
        message:
          "Valid latitude and longitude are required.",
      });
    }

    if (
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      console.error(
        "❌ Coordinates are outside valid range"
      );

      return res.status(400).json({
        success: false,
        message:
          "Invalid latitude or longitude.",
      });
    }

    // ----------------------------------------------------------
    // Reverse geocoding
    // ----------------------------------------------------------

    const geocodingUrl =
      "https://nominatim.openstreetmap.org/reverse" +
      "?format=jsonv2" +
      `&lat=${encodeURIComponent(lat)}` +
      `&lon=${encodeURIComponent(lon)}` +
      "&zoom=18" +
      "&addressdetails=1";

    console.log(
      "🌍 Requesting address from reverse geocoding service..."
    );

    const response = await fetch(
      geocodingUrl,
      {
        method: "GET",

        headers: {
          "User-Agent":
            "Aayuvora Healthcare Prototype/1.0",
          "Accept":
            "application/json",
        },
      }
    );

    const responseText =
      await response.text();

    if (!response.ok) {
      console.error(
        "❌ Reverse geocoding failed:",
        response.status,
        responseText
      );

      return res.status(502).json({
        success: false,
        message:
          "Unable to fetch the current address.",
        details: responseText,
      });
    }

    let location;

    try {
      location =
        JSON.parse(responseText);
    } catch (parseError) {
      console.error(
        "❌ Invalid geocoding response:",
        responseText
      );

      return res.status(502).json({
        success: false,
        message:
          "Invalid address response received.",
      });
    }

    const fetchedAddress =
      String(
        location?.display_name || ""
      ).trim();

    if (!fetchedAddress) {
      console.error(
        "❌ Address was not available."
      );

      return res.status(404).json({
        success: false,
        message:
          "Unable to determine the current address.",
      });
    }

    console.log(
      "📍 FETCHED ADDRESS:"
    );

    console.log(
      fetchedAddress
    );

    console.log(
      "========================================"
    );

    // ----------------------------------------------------------
    // Return location + address to frontend
    // ----------------------------------------------------------

    return res.status(200).json({
      success: true,

      message:
        "Ambulance location fetched successfully.",

      patientId:
        patientId || null,

      patientName:
        patientName || null,

      latitude: lat,

      longitude: lon,

      address:
        fetchedAddress,

      display_name:
        fetchedAddress,

      location: {
        latitude: lat,
        longitude: lon,
        address: fetchedAddress,
      },
    });

  } catch (error) {
    console.error(
      "========================================"
    );

    console.error(
      "❌ SOS AMBULANCE ERROR"
    );

    console.error(error);

    console.error(
      "========================================"
    );

    return res.status(500).json({
      success: false,

      message:
        error instanceof Error
          ? error.message
          : "Unable to fetch ambulance address.",
    });
  }
});
const SARVAM_API_KEY =
  String(process.env.SARVAM_API_KEY || "").trim();

const SARVAM_CHAT_MODEL =
  process.env.SARVAM_CHAT_MODEL || "sarvam-105b";

const twilioClient =
  process.env.TWILIO_ACCOUNT_SID &&
  process.env.TWILIO_AUTH_TOKEN
    ? twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      )
    : null;

const TWILIO_VERIFY_SERVICE_SID =
  process.env.TWILIO_VERIFY_SERVICE_SID;

/* =========================================================
   IN-MEMORY DATA
========================================================= */

const appointmentBookings = [];

const emergencyRequests = [];

const prescriptionRecords = new Map();

const consultationSummaries = new Map();

const prescriptionOrders = new Map();

/* =========================================================
   HELPERS
========================================================= */

const normalizePhone = (phone) =>
  String(phone || "").trim();

const normalizeText = (value) =>
  String(value || "").trim();

const createVideoRoom = (
  prefix = "AAYUVORA"
) =>
  `${prefix}-${crypto
    .randomUUID()
    .replace(/-/g, "")
    .slice(0, 20)}`;

const createVideoUrl = (roomId) =>
  `https://meet.jit.si/${encodeURIComponent(roomId)}`;

const isAppointmentActive = (booking) =>
  booking.status !== "cancelled" &&
  booking.status !== "completed";

const isEmergencyActive = (request) =>
  request.status === "waiting" ||
  request.status === "connected";

const getSarvamErrorMessage = (
  data,
  fallback
) => {
  return (
    data?.error?.message ||
    data?.error?.detail ||
    data?.message ||
    data?.error ||
    fallback
  );
};

/* =========================================================
   ROOT / HEALTH
========================================================= */

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Aayuvora backend is running",
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    service: "Aayuvora",
    sarvamConfigured: Boolean(SARVAM_API_KEY),
    twilioConfigured: Boolean(twilioClient),
    chatModel: SARVAM_CHAT_MODEL,
  });
});

/* =========================================================
   TWILIO VERIFY
   Twilio generates and sends the OTP.
   This backend never generates a separate OTP.
========================================================= */

app.post("/api/send-otp", async (req, res) => {
  try {
    const phone = normalizePhone(
      req.body.phone ||
        req.body.phoneNumber
    );

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required.",
      });
    }

    if (
      !twilioClient ||
      !TWILIO_VERIFY_SERVICE_SID
    ) {
      return res.status(500).json({
        success: false,
        message:
          "Twilio Verify is not configured.",
      });
    }

    const verification =
      await twilioClient.verify.v2
        .services(TWILIO_VERIFY_SERVICE_SID)
        .verifications.create({
          to: phone,
          channel: "sms",
        });

    return res.json({
      success: true,
      status: verification.status,
    });
  } catch (error) {
    console.error(
      "[TWILIO SEND OTP ERROR]",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Unable to send OTP.",
    });
  }
});

app.post("/api/verify-otp", async (req, res) => {
  try {
    const phone = normalizePhone(
      req.body.phone ||
        req.body.phoneNumber
    );

    const code = normalizeText(
      req.body.code ||
        req.body.otp
    );

    if (!phone || !code) {
      return res.status(400).json({
        success: false,
        message:
          "Phone number and OTP are required.",
      });
    }

    if (
      !twilioClient ||
      !TWILIO_VERIFY_SERVICE_SID
    ) {
      return res.status(500).json({
        success: false,
        message:
          "Twilio Verify is not configured.",
      });
    }

    const check =
      await twilioClient.verify.v2
        .services(TWILIO_VERIFY_SERVICE_SID)
        .verificationChecks.create({
          to: phone,
          code,
        });

    return res.json({
      success: check.status === "approved",
      status: check.status,
    });
  } catch (error) {
    console.error(
      "[TWILIO VERIFY OTP ERROR]",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Unable to verify OTP.",
    });
  }
});

/* =========================================================
   SARVAM CHAT
========================================================= */

app.post("/api/chat", async (req, res) => {
  try {
    if (!SARVAM_API_KEY) {
      return res.status(500).json({
        success: false,
        error:
          "SARVAM_API_KEY is not configured.",
      });
    }

    const {
      message,
      history = [],
      messages: directMessages = [],
      language = "en",
      careMode = "modern",
      ayushPhase = "general",
      ayushDashavidhaAnswers = {},
      askedAiQuestions = [],
      lastAiQuestion = "",
      ayushInstruction = "",
    } = req.body || {};

    /*
      Support BOTH formats:

      1. Existing Aayuvora frontend:
         message + history

      2. Direct Sarvam-compatible format:
         messages
    */

    let chatMessages = [];

    if (
      Array.isArray(directMessages) &&
      directMessages.length > 0
    ) {
      chatMessages =
        directMessages
          .map((item) => ({
            role:
              item?.role === "model"
                ? "assistant"
                : item?.role === "assistant"
                  ? "assistant"
                  : item?.role === "system"
                    ? "system"
                    : "user",
            content: String(
              item?.content ??
                item?.text ??
                ""
            ).trim(),
          }))
          .filter(
            (item) => item.content
          );
    } else {
      if (
        !Array.isArray(history)
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Chat history must be an array.",
        });
      }

      chatMessages =
        history
          .map((item) => ({
            role:
              item?.role === "model"
                ? "assistant"
                : item?.role === "assistant"
                  ? "assistant"
                  : item?.role === "system"
                    ? "system"
                    : "user",
            content: String(
              item?.content ??
                item?.text ??
                ""
            ).trim(),
          }))
          .filter(
            (item) => item.content
          );

      if (
        typeof message === "string" &&
        message.trim()
      ) {
        chatMessages.push({
          role: "user",
          content: message.trim(),
        });
      }
    }

    if (
      !chatMessages.length
    ) {
      return res.status(400).json({
        success: false,
        error: "Message is required.",
      });
    }

    /*
      Keep the healthcare workflow instructions
      on the backend so the frontend only sends
      patient conversation data.
    */

    const systemInstruction = `
You are Aayuvora's clinical intake assistant.

Preferred language:
${language}

Care mode:
${careMode}

AYUSH phase:
${ayushPhase}

The patient is using a healthcare pre-consultation workflow.

Your job is to collect and organize information.
Do not diagnose the patient.
Do not prescribe medication.
Do not invent medical information.

Ask one useful follow-up question at a time.

For modern care:
- Ask about the main concern.
- Ask about symptoms.
- Ask duration.
- Ask relevant history.
- Ask medicines and allergies when appropriate.
- Ask family/personal history when relevant.
- Ask lifestyle information when relevant.

For AYUSH care:
- Respect the Dashavidha Pariksha answers already collected.
- Do not repeatedly ask the same Dashavidha question.
- Continue with the remaining health-history questions.
- Include relevant Ahara-Vihara information.

Already asked AI questions:
${JSON.stringify(
  askedAiQuestions
)}

Last AI question:
${lastAiQuestion}

Dashavidha answers:
${JSON.stringify(
  ayushDashavidhaAnswers
)}

Additional workflow instruction:
${ayushInstruction}

Respond naturally in the preferred language.
Keep responses concise and suitable for a patient-facing healthcare intake screen.
`;

    const finalMessages = [
      {
        role: "system",
        content:
          systemInstruction.trim(),
      },
      ...chatMessages,
    ];

    console.log(
      `[SARVAM CHAT] model=${SARVAM_CHAT_MODEL} language=${language} messages=${finalMessages.length}`
    );

    /*
      Sarvam's current Chat Completion API
      accepts api-subscription-key.
    */

    const response = await fetch(
      "https://api.sarvam.ai/v1/chat/completions",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          "api-subscription-key":
            SARVAM_API_KEY,
        },

        body: JSON.stringify({
          model: SARVAM_CHAT_MODEL,

          messages: finalMessages,

          temperature: 0.2,

          max_tokens: 500,

          /*
            Disable reasoning for this short,
            patient-facing conversational workflow.
          */
          reasoning_effort: null,
        }),
      }
    );

    const responseText =
      await response.text();

    let data = {};

    try {
      data = responseText
        ? JSON.parse(responseText)
        : {};
    } catch {
      console.error(
        "[SARVAM CHAT] Non-JSON response:",
        responseText
      );

      return res.status(502).json({
        success: false,
        error:
          "Sarvam AI returned an invalid response.",
      });
    }

    if (!response.ok) {
      console.error(
        "[SARVAM CHAT ERROR]",
        response.status,
        data
      );

      return res.status(
        response.status
      ).json({
        success: false,
        error: getSarvamErrorMessage(
          data,
          "Sarvam AI chat request failed."
        ),
        details: data,
      });
    }

    const reply =
      data?.choices?.[0]?.message
        ?.content ||
      data?.choices?.[0]?.text ||
      "";

    const cleanReply =
      String(reply).trim();

    if (!cleanReply) {
      console.error(
        "[SARVAM CHAT] Empty response:",
        data
      );

      return res.status(502).json({
        success: false,
        error:
          "Sarvam AI returned no text.",
      });
    }

    return res.json({
      success: true,

      /*
        Frontend expects result.reply.
      */
      reply: cleanReply,

      /*
        Also expose content for compatibility.
      */
      content: cleanReply,

      response: data,
    });
  } catch (error) {
    console.error(
      "[SARVAM CHAT EXCEPTION]",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error instanceof Error
          ? `Sarvam chat failed: ${error.message}`
          : "Sarvam chat failed.",
    });
  }
});

/* =========================================================
   SARVAM TEXT TO SPEECH
========================================================= */

const SARVAM_LANGUAGE_CODES = {
  en: "en-IN",
  hi: "hi-IN",
  bn: "bn-IN",
  mr: "mr-IN",
  te: "te-IN",
  ta: "ta-IN",
};

app.post("/api/tts", async (req, res) => {
  try {
    if (!SARVAM_API_KEY) {
      return res.status(500).json({
        success: false,
        error:
          "SARVAM_API_KEY is not configured.",
      });
    }

    const text =
      normalizeText(req.body.text);

    if (!text) {
      return res.status(400).json({
        success: false,
        error: "Text is required.",
      });
    }

    /*
      The frontend sends:
        language_code
        language
        target_language_code

      Accept all three so older frontend
      code remains compatible.
    */

    const requestedLanguage =
      req.body.language_code ||
      req.body.target_language_code ||
      req.body.language ||
      "en";

    const languageCode =
      SARVAM_LANGUAGE_CODES[
        requestedLanguage
      ] ||
      String(
        requestedLanguage
      );

    const speaker =
      normalizeText(
        req.body.speaker
      ) || "shubh";

    console.log(
      `[SARVAM TTS] language=${languageCode} speaker=${speaker}`
    );

    const response = await fetch(
      "https://api.sarvam.ai/text-to-speech",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          "api-subscription-key":
            SARVAM_API_KEY,
        },

        body: JSON.stringify({
          text: text.slice(0, 2500),

          language_code:
            languageCode,

          speaker,

          model: "bulbul:v3",

          pace: 1.0,

          speech_sample_rate: 24000,

          output_audio_codec: "wav",
        }),
      }
    );

    const responseText =
      await response.text();

    let data = {};

    try {
      data = responseText
        ? JSON.parse(responseText)
        : {};
    } catch {
      console.error(
        "[SARVAM TTS] Invalid JSON:",
        responseText
      );

      return res.status(502).json({
        success: false,
        error:
          "Sarvam TTS returned an invalid response.",
      });
    }

    if (!response.ok) {
      console.error(
        "[SARVAM TTS ERROR]",
        response.status,
        data
      );

      return res.status(
        response.status
      ).json({
        success: false,
        error: getSarvamErrorMessage(
          data,
          "Sarvam TTS request failed."
        ),
        details: data,
      });
    }

    /*
      Sarvam returns:

      audios: [
        "BASE64_AUDIO_DATA"
      ]

      The old backend was returning the array
      as `audios`, while the frontend was looking
      for `audio`.

      We normalize it here.
    */

    const audio =
      Array.isArray(data?.audios)
        ? data.audios[0]
        : typeof data?.audio === "string"
          ? data.audio
          : "";

    if (
      !audio ||
      typeof audio !== "string"
    ) {
      console.error(
        "[SARVAM TTS] No audio returned:",
        data
      );

      return res.status(502).json({
        success: false,
        error:
          "Sarvam AI returned no audio.",
        details: data,
      });
    }

    return res.json({
      success: true,

      /*
        Frontend expects this property.
      */
      audio,

      /*
        Keep audios too for compatibility.
      */
      audios: [audio],

      audioFormat: "wav",

      mimeType: "audio/wav",

      languageCode,

      speaker,
    });
  } catch (error) {
    console.error(
      "[SARVAM TTS EXCEPTION]",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error instanceof Error
          ? `Speech generation failed: ${error.message}`
          : "Speech generation failed.",
    });
  }
});

/* =========================================================
   MEDICAL DOCUMENT OCR
========================================================= */

app.post("/api/ocr", async (req, res) => {
  try {
    const {
      fileName,
      mimeType,
      base64Data,
      language = "en"
    } = req.body || {};

    if (!fileName || !base64Data) {
      return res.status(400).json({
        success: false,
        error: "No valid document was received."
      });
    }

    const result = await processMedicalDocument(
      {
        fileName,
        mimeType,
        base64Data
      },
      language
    );

    return res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error("OCR error:", error);

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "Medical Document OCR failed"
    });
  }
});

/* =========================================================
   APPOINTMENTS
========================================================= */

app.get(
  "/api/appointments",
  (req, res) => {
    let results = [
      ...appointmentBookings,
    ];

    if (req.query.doctorId) {
      results =
        results.filter(
          (booking) =>
            String(
              booking.doctorId
            ) ===
            String(
              req.query.doctorId
            )
        );
    }

    if (req.query.date) {
      results =
        results.filter(
          (booking) =>
            String(
              booking.appointmentDate
            ) ===
            String(req.query.date)
        );
    }

    if (req.query.patientId) {
      results =
        results.filter(
          (booking) =>
            String(
              booking.patientId
            ) ===
            String(
              req.query.patientId
            )
        );
    }

    if (
      req.query.active ===
      "true"
    ) {
      results =
        results.filter(
          isAppointmentActive
        );
    }

    return res.json({
      success: true,
      appointments: results,
    });
  }
);

app.post(
  "/api/appointments",
  (req, res) => {
    try {
      const {
        patientId,
        patientName,
        patientPhone,
        doctorId,
        doctorName,
        hospitalId,
        hospitalName,
        appointmentDate,
        date,
        timeSlot,
        appointmentType = "offline",
        careMode = "modern",
      } = req.body;

      const selectedDate =
        appointmentDate || date;

      if (
        !patientId ||
        !doctorId ||
        !selectedDate ||
        !timeSlot
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Patient, doctor, date and time slot are required.",
        });
      }

      const taken =
        appointmentBookings.some(
          (booking) =>
            isAppointmentActive(
              booking
            ) &&
            String(
              booking.doctorId
            ) ===
              String(doctorId) &&
            String(
              booking.appointmentDate
            ) ===
              String(selectedDate) &&
            String(
              booking.timeSlot
            ) ===
              String(timeSlot)
        );

      if (taken) {
        return res.status(409).json({
          success: false,
          message:
            "This appointment slot is already booked.",
        });
      }

      const appointmentId =
        `APPT-${crypto.randomUUID()}`;

      const videoRoomId =
        appointmentType ===
        "online"
          ? createVideoRoom(
              "AAYUVORA-ONLINE"
            )
          : null;

      const booking = {
        appointmentId,

        patientId,

        patientName:
          patientName || "",

        patientPhone:
          patientPhone || "",

        doctorId,

        doctorName:
          doctorName || "",

        hospitalId:
          hospitalId || "",

        hospitalName:
          hospitalName || "",

        date: selectedDate,

        appointmentDate:
          selectedDate,

        timeSlot,

        appointmentType:
          appointmentType ===
          "online"
            ? "online"
            : "offline",

        careMode,

        videoRoomId,

        videoUrl: videoRoomId
          ? createVideoUrl(
              videoRoomId
            )
          : null,

        status: "booked",

        createdAt:
          new Date().toISOString(),
      };

      appointmentBookings.push(
        booking
      );

      return res.status(201).json({
        success: true,
        appointment: booking,
      });
    } catch (error) {
      console.error(
        "[APPOINTMENT ERROR]",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to book appointment.",
      });
    }
  }
);

app.post(
  "/api/appointments/:appointmentId/cancel",
  (req, res) => {
    const appointment =
      appointmentBookings.find(
        (item) =>
          item.appointmentId ===
          req.params.appointmentId
      );

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message:
          "Appointment not found.",
      });
    }

    appointment.status =
      "cancelled";

    appointment.cancelledAt =
      new Date().toISOString();

    return res.json({
      success: true,
      appointment,
    });
  }
);

/* =========================================================
   CLINICAL SUMMARY
========================================================= */

app.get(
  "/api/consultations/:appointmentId/summary",
  (req, res) => {
    const appointmentId =
      String(
        req.params.appointmentId
      );

    const record =
      consultationSummaries.get(
        appointmentId
      );

    return res.json({
      success: true,
      appointmentId,
      summary:
        record?.summary || null,
    });
  }
);

app.post(
  "/api/consultations/:appointmentId/summary",
  (req, res) => {
    try {
      const appointmentId =
        String(
          req.params.appointmentId
        ).trim();

      if (!appointmentId) {
        return res.status(400).json({
          success: false,
          message:
            "Appointment ID is required.",
        });
      }

      const record = {
        appointmentId,

        summary:
          req.body.summary || "",

        complaint:
          req.body.complaint || "",

        redFlagDetection:
          req.body.redFlagDetection ||
          "",

        reviewOfSystems:
          req.body.reviewOfSystems ||
          "",

        updatedAt:
          new Date().toISOString(),
      };

      consultationSummaries.set(
        appointmentId,
        record
      );

      return res.json({
        success: true,
        summary: record,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Summary could not be saved.",
      });
    }
  }
);

/* =========================================================
   ONLINE PRESCRIPTIONS
========================================================= */

app.get(
  "/api/prescriptions/:appointmentId",
  (req, res) => {
    const appointmentId =
      String(
        req.params.appointmentId
      );

    const record =
      prescriptionRecords.get(
        appointmentId
      );

    return res.json({
      success: true,

      prescriptions:
        record?.prescriptions || [],

      appointmentId,
    });
  }
);

app.post(
  "/api/prescriptions/:appointmentId",
  (req, res) => {
    try {
      const appointmentId =
        String(
          req.params.appointmentId
        ).trim();

      const appointment =
        appointmentBookings.find(
          (item) =>
            String(
              item.appointmentId
            ) === appointmentId
        );

      if (!appointment) {
        return res.status(404).json({
          success: false,
          message:
            "Appointment not found.",
        });
      }

      if (
        appointment.appointmentType !==
        "online"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Prescriptions can only be attached to online appointments.",
        });
      }

      const prescriptions =
        Array.isArray(
          req.body.prescriptions
        )
          ? req.body.prescriptions
              .map((item) => ({
                medicine:
                  normalizeText(
                    item?.medicine
                  ),

                dosage:
                  normalizeText(
                    item?.dosage
                  ),

                frequency:
                  normalizeText(
                    item?.frequency
                  ),

                duration:
                  normalizeText(
                    item?.duration
                  ),

                instructions:
                  normalizeText(
                    item?.instructions
                  ),
              }))
              .filter(
                (item) =>
                  item.medicine
              )
          : [];

      const record = {
        appointmentId,

        patientId:
          appointment.patientId,

        doctorId:
          appointment.doctorId,

        prescriptions,

        updatedAt:
          new Date().toISOString(),
      };

      prescriptionRecords.set(
        appointmentId,
        record
      );

      return res.json({
        success: true,
        prescriptions,
        record,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Prescription could not be saved.",
      });
    }
  }
);

/* =========================================================
   PRESCRIPTION ORDER
========================================================= */

app.get(
  "/api/prescriptions/:appointmentId/order",
  (req, res) => {
    const appointmentId =
      String(
        req.params.appointmentId
      );

    const order =
      prescriptionOrders.get(
        appointmentId
      );

    return res.json({
      success: true,
      order: order || null,
      appointmentId,
    });
  }
);

app.post(
  "/api/prescriptions/:appointmentId/order",
  (req, res) => {
    try {
      const appointmentId =
        String(
          req.params.appointmentId
        ).trim();

      const prescription =
        prescriptionRecords.get(
          appointmentId
        );

      if (!prescription) {
        return res.status(404).json({
          success: false,
          message:
            "Prescription not found.",
        });
      }

      if (
        !prescription.prescriptions ||
        prescription.prescriptions
          .length === 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "No prescription is available for this appointment.",
        });
      }

      const {
        addressLine1,
        addressLine2,
        pinCode,
        city,
      } = req.body || {};

      const order = {
        orderId:
          `ORDER-${crypto.randomUUID()}`,

        appointmentId,

        prescriptions:
          prescription.prescriptions,

        address: {
          addressLine1:
            normalizeText(
              addressLine1
            ),

          addressLine2:
            normalizeText(
              addressLine2
            ),

          pinCode:
            normalizeText(
              pinCode
            ),

          city:
            normalizeText(city),
        },

        status: "confirmed",

        createdAt:
          new Date().toISOString(),
      };

      prescriptionOrders.set(
        appointmentId,
        order
      );

      return res.status(201).json({
        success: true,
        order,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Order could not be created.",
      });
    }
  }
);

/* =========================================================
   EMERGENCY
========================================================= */

app.get(
  "/api/emergency",
  (req, res) => {
    let requests = [
      ...emergencyRequests,
    ];

    if (
      req.query.active ===
      "true"
    ) {
      requests =
        requests.filter(
          isEmergencyActive
        );
    }

    if (req.query.doctorId) {
      requests =
        requests.filter(
          (request) =>
            String(
              request.doctorId
            ) ===
            String(
              req.query.doctorId
            )
        );
    }

    return res.json({
      success: true,
      requests,
    });
  }
);

app.post(
  "/api/emergency",
  (req, res) => {
    try {
      const {
        patientId,
        patientName,
        careMode = "modern",
        doctors = [],
      } = req.body;

      if (!patientId) {
        return res.status(400).json({
          success: false,
          message:
            "Patient ID is required.",
        });
      }

      if (
        !Array.isArray(doctors) ||
        !doctors.length
      ) {
        return res.status(400).json({
          success: false,
          message:
            "At least one doctor is required for emergency routing.",
        });
      }

      const roster =
        doctors.filter(
          (doctor) =>
            !doctor.careMode ||
            doctor.careMode ===
              careMode
        );

      const doctorRoster =
        roster.length
          ? roster
          : doctors;

      const availableDoctor =
        doctorRoster.find(
          (doctor) => {
            const id =
              String(
                doctor.id ||
                  doctor.doctorId ||
                  ""
              );

            if (!id) {
              return false;
            }

            const doctorBusy =
              appointmentBookings.some(
                (booking) =>
                  isAppointmentActive(
                    booking
                  ) &&
                  String(
                    booking.doctorId
                  ) === id
              );

            const emergencyBusy =
              emergencyRequests.some(
                (request) =>
                  isEmergencyActive(
                    request
                  ) &&
                  String(
                    request.doctorId
                  ) === id
              );

            return (
              !doctorBusy &&
              !emergencyBusy
            );
          }
        );

      const selectedDoctor =
        availableDoctor ||
        doctorRoster[0];

      if (!selectedDoctor) {
        return res.status(503).json({
          success: false,
          message:
            "No doctor is available for emergency consultation.",
        });
      }

      const doctorId =
        String(
          selectedDoctor.id ||
            selectedDoctor.doctorId ||
            ""
        );

      const doctorName =
        selectedDoctor.name ||
        selectedDoctor.doctorName ||
        "Doctor";

      const request = {
        emergencyId:
          `EMERGENCY-${crypto.randomUUID()}`,

        patientId,

        patientName:
          patientName || "",

        doctorId,

        doctorName,

        hospitalId:
          selectedDoctor.hospitalId ||
          "",

        hospitalName:
          selectedDoctor.hospitalName ||
          selectedDoctor.hospital ||
          "",

        careMode,

        videoRoomId:
          createVideoRoom(
            "AAYUVORA-EMERGENCY"
          ),

        videoUrl: "",

        status: "waiting",

        createdAt:
          new Date().toISOString(),
      };

      request.videoUrl =
        createVideoUrl(
          request.videoRoomId
        );

      emergencyRequests.push(
        request
      );

      return res.status(201).json({
        success: true,
        request,
        fallbackUsed:
          !availableDoctor,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to create emergency consultation.",
      });
    }
  }
);

app.post(
  "/api/emergency/:emergencyId/connect",
  (req, res) => {
    const request =
      emergencyRequests.find(
        (item) =>
          item.emergencyId ===
          req.params.emergencyId
      );

    if (!request) {
      return res.status(404).json({
        success: false,
        message:
          "Emergency request not found.",
      });
    }

    if (
      request.status ===
      "completed"
    ) {
      return res.status(409).json({
        success: false,
        message:
          "This emergency consultation has already been completed.",
      });
    }

    request.status =
      "connected";

    request.connectedAt =
      new Date().toISOString();

    return res.json({
      success: true,
      request,
    });
  }
);

app.post(
  "/api/emergency/:emergencyId/complete",
  (req, res) => {
    const request =
      emergencyRequests.find(
        (item) =>
          item.emergencyId ===
          req.params.emergencyId
      );

    if (!request) {
      return res.status(404).json({
        success: false,
        message:
          "Emergency request not found.",
      });
    }

    request.status =
      "completed";

    request.completedAt =
      new Date().toISOString();

    return res.json({
      success: true,
      request,
    });
  }
);

/* =========================================================
   404
========================================================= */

app.use(
  (req, res) => {
    res.status(404).json({
      success: false,
      message:
        "API endpoint not found.",
      path: req.originalUrl,
    });
  }
);

/* =========================================================
   GLOBAL ERROR HANDLER
========================================================= */

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      "[GLOBAL ERROR]",
      error
    );

    res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Internal server error.",
    });
  }
);

/* =========================================================
   START SERVER
========================================================= */

app.listen(
  PORT,
  () => {
    console.log(
      `Aayuvora backend running on http://localhost:${PORT}`
    );

    console.log(
      `Sarvam configured: ${Boolean(
        SARVAM_API_KEY
      )}`
    );

    console.log(
      `Sarvam chat model: ${SARVAM_CHAT_MODEL}`
    );

    console.log(
      `Twilio Verify configured: ${Boolean(
        twilioClient &&
          TWILIO_VERIFY_SERVICE_SID
      )}`
    );
  }
);