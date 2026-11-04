import { noteWorkflow, } from "./noteWorkflow";

/* status -> trigger -> next status, from contract/note-workflow.json. */
export const noteTransitions = noteWorkflow.transitions;
