// @ts-check

require("dotenv").config();

const axios = require("axios").default.create({
  baseURL: "http://localhost:5001",
  headers: {
    "User-Agent": "RemoteControlClient/" + require("./package.json").version,
    "X-Real-IP": "127.0.0.1", // debug only
  },
  timeout: 3000,
});

const assert = require("assert");
const clientId = process.env["RUSTDESK_ID"];
const ctrl = require("./client-control-api");
assert(clientId && /^\d+$/.test(clientId), "config RUSTDESK_ID is not set or is invalid");

let currPassword = "";

async function registerClient() {
  console.log("registering client...");
  if (currPassword === "") {
    currPassword = await ctrl.changePassword();
  }
  /**
   * @typedef SRegisterClientResponse
   * @prop {boolean} success
   * @prop {string} message
   */
  /**
   * @type {SRegisterClientResponse}
   */
  const response = (
    await axios.post("/api/remote-control/registerClient", {
      clientId,
      password: currPassword,
    })
  ).data;
  console.log("received register client response", response);
  if (response.success) {
    return;
  }
  if (response.message === "Client already registered with different IP") {
    console.error(new Date(), "registerClient failed due to conflicting IP");
    // if IP has changed, the old IP will be marked as dead after a short while, after which
    // we can re-register successfully. So we can directly return here.
    return;
  } else {
    console.error(new Date(), "registerClient failed:", response.message);
  }
}

async function tick() {
  console.log(new Date(), "starting new tick...");
  await ctrl.spawnMain();
  /**
   * @typedef SUpdateDirective
   * @prop {number} id
   * @prop {"changePassword"} command
   * @prop {string[]} args
   *
   * @typedef SUpdateResponse
   * @prop {boolean} success
   * @prop {string} message
   * @prop {SUpdateDirective | null} update
   */
  /**
   * @type {SUpdateResponse}
   */
  const response = (
    await axios.get("/api/remote-control/getUpdate/" + clientId, {
      responseType: "json",
    })
  ).data;
  console.log("received update", response);
  if (!response.success) {
    if (response.message === "Client not registered") {
      await registerClient();
    } else {
      console.error(new Date(), "Server error:", response.message);
    }
    return;
  }
  if (response.message === "no update") {
    return;
  }
  if (response.update === null) {
    console.error(new Date(), "Server error: missing update body");
    return;
  }
  const update = response.update;
  if (update.command === "changePassword") {
    let password;
    try {
      password = await ctrl.changePassword(update.args[0]);
    } catch (e) {
      await axios.post("/api/remote-control/rejectUpdate", {
        clientId,
        commandId: update.id,
        reportedResult: e.message || "client error",
      });
      return;
    }
    /**
     * @typedef SSyncPasswordResponse
     * @prop {boolean} success
     * @prop {string} message
     */
    /**
     * @type {SSyncPasswordResponse}
     */
    const syncResp = (
      await axios.post("/api/remote-control/updatePassword", {
        clientId,
        commandId: update.id,
        password,
      })
    ).data;
    if (syncResp.success) {
      currPassword = password;
      return;
    }
    try {
      await ctrl.changePassword(currPassword); // rollback
    } catch (e) {
      console.error(new Date(), "Password rollback failed:", e.message);
      currPassword = password;
    }
    if (syncResp.message === "Client not registered") {
      await registerClient();
    } else if (syncResp.message === "IP mismatch") {
      console.error(new Date(), "updatePassword failed: IP mismatch");
      // if IP has changed, the old IP will be marked as dead after a short while, after which
      // we can re-register successfully. So we can directly return here.
      return;
    } else {
      console.error(new Date(), "updatePassword failed:", syncResp.message);
    }
  } else {
    console.error(new Date(), "Error: unknown update command", update.command);
  }
}

process.on("uncaughtException", (e) => {
  console.error(new Date(), "uncaughtException", e.message);
});

setInterval(tick, 1000 * 10);
tick();
