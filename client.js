// @ts-check

require("dotenv").config();

const axios = require("axios").default.create({
  baseURL: `http://${process.env["HOST"]}:${process.env["PORT"]}`,
  headers: {
    "User-Agent": "RemoteControlClient/" + require("./package.json").version,
    "X-Real-IP": require("address").ip("WLAN") || "failed to get", // debug only
  },
  timeout: 5000,
});

const ctrl = require("./client-control-api");

/**
 * @type {string | null}
 */
let clientId = null;
let currPassword = "";
let tickPending = false;
let tickPendingRound = 0;

/**
 * @typedef UpdateExecResult
 * @prop {boolean} success
 * @prop {string} [message]
 */

/**
 * @typedef SClientIdResponse
 * @prop {boolean} success
 * @prop {string} message
 * @prop {{ clientId: string }} data
 */

async function getClientId() {
  try {
    /**
     * @type {SClientIdResponse}
     */
    const resp = (await axios.get("/api/remote-control/getAvailableClientId")).data;
    if (!resp.success) {
      console.error(new Date(), "failed to get client id", resp.message);
      return null;
    }
    return resp.data.clientId;
  } catch (e) {
    console.error(new Date(), "failed to get client id", e.message);
    return null;
  }
}

/**
 * @typedef SRegisterClientResponse
 * @prop {boolean} success
 * @prop {string} message
 */

/**
 * @param {string} clientId
 */
async function registerClient(clientId) {
  console.log("registering client...");
  if (currPassword === "") {
    currPassword = await ctrl.setPassword();
  }
  try {
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
      return true;
    }
    if (response.message === "Client already registered with different IP") {
      console.error(new Date(), "registerClient failed due to conflicting IP");
      // if IP has changed, the old IP will be marked as dead after a short while, after which
      // we can re-register successfully. So we can directly return here.
      return false;
    } else {
      console.error(new Date(), "registerClient failed:", response.message);
      return false;
    }
  } catch (e) {
    console.error(new Date(), "registerClient failed:", e.message);
    return false;
  }
}

/**
 * @typedef SUpdateDirective
 * @prop {number} id
 * @prop {"changePassword" | "restartPC"} command
 * @prop {string[]} args
 *
 * @typedef SUpdateResponse
 * @prop {boolean} success
 * @prop {string} message
 * @prop {SUpdateDirective | null} data
 */

async function tick() {
  if (tickPending) {
    console.error(new Date(), "old tick still pending, sleeping for this round...");
    tickPendingRound++;
    if (tickPendingRound >= 3) {
      console.error(new Date(), "tick pending for too long, aborting...");
      // @TODO: report error to server
      process.exit(1);
    }
    return;
  }
  tickPending = true;
  const tickStart = new Date();
  console.log(tickStart, "starting new tick...");
  await ctrl.spawnMain();
  if (clientId === null) {
    clientId = await getClientId();
    if (clientId === null) {
      console.error(new Date(), "failed to get client id, aborting");
      process.exit(1);
    }
    ctrl.setClientId(clientId);
  }
  /**
   * @type {SUpdateDirective | null}
   */
  let update = null;
  try {
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
        const succ = await registerClient(clientId);
        if (!succ) {
          console.error(new Date(), "failed to register client, aborting");
          process.exit(1);
        }
      } else {
        console.error(new Date(), "Server error:", response.message);
      }
      tickPending = false;
      return;
    }
    if (response.message === "no update") {
      tickPending = false;
      return;
    }
    if (response.data === null) {
      console.error(new Date(), "Server error: missing update body");
      tickPending = false;
      return;
    }
    update = response.data;
  } catch (e) {
    console.error(new Date(), "failed to get update", e.message);
    tickPending = false;
    return;
  }

  /**
   * @type {UpdateExecResult | null}
   */
  let result = null;
  try {
    if (update.command === "changePassword") {
      result = await changePassword(update.args);
      if (result.success) {
        await resolveUpdate(update.id);
      } else {
        throw new Error(result.message);
      }
    } else if (update.command === "restartPC") {
      await resolveUpdate(update.id).catch(() => {}); // resolve first, ignore error
      ctrl.restartPC(); // we should not await this!
    } else {
      console.error(new Date(), "Error: unknown update command", update.command);
      throw new Error("unknown update command");
    }
  } catch (e) {
    if (result) {
      await rejectUpdate(update.id, result.message);
    } else {
      await rejectUpdate(update.id, e.message);
    }
  }
  const tickEnd = new Date();
  console.log(tickEnd, "tick finished in", tickEnd.getTime() - tickStart.getTime(), "ms");
  tickPending = false;
}

/**
 * @typedef SSyncPasswordResponse
 * @prop {boolean} success
 * @prop {string} message
 */

/**
 * @param {string[]} args
 * @returns {Promise<UpdateExecResult>}
 */
async function changePassword(args) {
  let password;
  try {
    password = await ctrl.setPassword(args[0]);
  } catch (e) {
    return {
      success: false,
      message: e.message || "client error inside ctrl.setPassword",
    };
  }
  /**
   * @type {SSyncPasswordResponse}
   */
  const syncResp = (
    await axios.post("/api/remote-control/syncPassword", {
      clientId,
      password,
    })
  ).data;
  if (syncResp.success) {
    currPassword = password;
    return {
      success: true,
    };
  }
  // syncPassword failed handler
  try {
    await ctrl.setPassword(currPassword); // rollback
  } catch (e) {
    console.error(new Date(), "Password rollback failed:", e.message);
    currPassword = password;
  }
  console.error(new Date(), "updatePassword failed:", syncResp.message);
  return {
    success: false,
    message: syncResp.message,
  };
}

/**
 * @param {number} commandId
 * @param {string} [reason]
 */
async function rejectUpdate(commandId, reason = "update rejected") {
  try {
    await axios.post("/api/remote-control/rejectUpdate", {
      clientId,
      commandId,
      reportedResult: reason,
    });
  } catch (e) {
    console.error(new Date(), "rejectUpdate failed:", e.message);
  }
}
/**
 * @param {number} commandId
 */
async function resolveUpdate(commandId) {
  try {
    await axios.post("/api/remote-control/resolveUpdate", {
      clientId,
      commandId,
    });
  } catch (e) {
    console.error(new Date(), "resolveUpdate failed:", e.message);
  }
}

process.on("uncaughtException", (e) => {
  console.error(new Date(), "uncaughtException", e.message);
});

setInterval(tick, 1000 * 10);
tick();
