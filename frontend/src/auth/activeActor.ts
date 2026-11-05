import type { Actor } from "../domain/actor";
import { CURRENT_ACTOR } from "./currentActor";

/*
 * The demo identity requests are sent as when a call does not name one,
 * such as loading the notes list. CurrentActorProvider keeps it in step
 * with the identity switcher.
 */
let activeActor: Actor = CURRENT_ACTOR;

export function getActiveActor(): Actor {
  return activeActor;
}

export function setActiveActor(actor: Actor): void {
  activeActor = actor;
}
