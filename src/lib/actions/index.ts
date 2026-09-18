/** Importing this module registers every action exactly once. */
import "./customers";
import "./services";
import "./staff";
import "./bookings";
import "./jobs";
import "./finance";
import "./expenses";
import "./reports";
import "./admin";
export { allActions, actionsFor, runAction, toolSchemas, getAction } from "../registry";
