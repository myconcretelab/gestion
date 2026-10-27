import "./helpers/emailTestData.js";
import assert from "node:assert/strict";
import test from "node:test";
import nodemailer from "nodemailer";
import { env } from "../src/config/env.js";
import prisma from "../src/db/prisma.js";
import router from "../src/routes/reservations.js";
import { resetSmtpTransportForTests } from "../src/services/mailer.js";

const layer = (router as any).stack.find(
  (item: any) => item.route?.path === "/:id/send-email",
);
const handler = layer.route.stack[0].handle;
const payload = {
  recipient: "guest@example.test",
  subject: "Votre séjour",
  body: "Bonjour <Camille>,\n\nÀ bientôt !",
};
const response = () => ({
  statusCode: 200,
  body: undefined as any,
  status(code: number) {
    this.statusCode = code;
    return this;
  },
  json(body: unknown) {
    this.body = body;
    return this;
  },
});

test("l’email de réservation valide le message et ne confirme que les envois acceptés", async (t) => {
  const original = {
    findUnique: prisma.reservation.findUnique,
    transport: nodemailer.createTransport,
    host: env.SMTP_HOST,
    from: env.SMTP_FROM,
  };
  const sent: any[] = [];
  t.after(() => {
    prisma.reservation.findUnique = original.findUnique;
    nodemailer.createTransport = original.transport;
    env.SMTP_HOST = original.host;
    env.SMTP_FROM = original.from;
    resetSmtpTransportForTests();
  });
  env.SMTP_HOST = "smtp.example.test";
  env.SMTP_FROM = "owner@example.test";
  nodemailer.createTransport = (() => ({
    verify: async () => true,
    sendMail: async (message: any) => {
      sent.push(message);
      return { accepted: [message.to], rejected: [], pending: [] };
    },
  })) as any;
  const findReservation = async ({ where }: any) => {
    assert.equal(where.id, "reservation-test");
    return {
      id: where.id,
      gite: { nom: "Le gîte", email: "gite@example.test" },
    };
  };
  prisma.reservation.findUnique = findReservation as any;
  resetSmtpTransportForTests();

  await t.test(
    "envoie le texte et un HTML échappé sans document joint ni modification de la réservation",
    async () => {
      const res = response();
      let error: unknown;
      await handler(
        {
          params: { id: "reservation-test" },
          body: { ...payload, recipient: " guest@example.test " },
        },
        res,
        (err: unknown) => {
          error = err;
        },
      );
      assert.equal(error, undefined);
      assert.deepEqual(res.body, { ok: true });
      assert.equal(sent.length, 1);
      assert.equal(sent[0].to, payload.recipient);
      assert.equal(sent[0].text, payload.body);
      assert.equal(sent[0].subject, payload.subject);
      assert.equal(sent[0].replyTo, "gite@example.test");
      assert.match(sent[0].html, /Bonjour &lt;Camille&gt;/);
      assert.equal(sent[0].attachments, undefined);
    },
  );

  await t.test(
    "refuse les adresses invalides, champs vides, contenus trop longs et entêtes injectés",
    async () => {
      for (const invalid of [
        { recipient: "bad-address" },
        { recipient: "a@example.test,b@example.test" },
        { subject: "  " },
        { body: "  " },
        { subject: "x".repeat(201) },
        { body: "x".repeat(20001) },
        { subject: "Sujet\r\nBcc: other@example.test" },
      ]) {
        const res = response();
        let error: any;
        await handler(
          {
            params: { id: "reservation-test" },
            body: { ...payload, ...invalid },
          },
          res,
          (err: unknown) => {
            error = err;
          },
        );
        assert.equal(error?.name, "ZodError");
        assert.equal(res.body, undefined);
      }
      assert.equal(sent.length, 1);
    },
  );

  await t.test(
    "ne contacte pas le serveur email pour une réservation absente",
    async () => {
      prisma.reservation.findUnique = (async () => null) as any;
      const res = response();
      await handler(
        { params: { id: "missing" }, body: payload },
        res,
        (err: unknown) => {
          throw err;
        },
      );
      assert.equal(res.statusCode, 404);
      assert.equal(sent.length, 1);
    },
  );

  await t.test("remonte l’erreur SMTP sans annoncer un succès", async () => {
    prisma.reservation.findUnique = findReservation as any;
    resetSmtpTransportForTests();
    nodemailer.createTransport = (() => ({
      verify: async () => {
        throw new Error("SMTP indisponible");
      },
    })) as any;
    const res = response();
    let error: any;
    await handler(
      { params: { id: "reservation-test" }, body: payload },
      res,
      (err: unknown) => {
        error = err;
      },
    );
    assert.equal(error?.statusCode, 502);
    assert.equal(res.body, undefined);
    assert.equal(sent.length, 1);
  });
});
