# AI-Assisted-Clinical-Notes-Workflow

## Project Overview

Clinical Notes Workflow is an application developed to manage AI-generated clinical notes created from clinician-patient sessions. Each note moves through different workflow stages, such as Generating, Ready for Review, In Review, Approved, Rejected, Amended, or Locked.
The application is used by clinicians, reviewers, administrators, and read-only auditors. Reviewers can examine and refine the generated SOAP note, while the workflow determines whether the note can be approved, rejected, returned for correction, or amended.
Correctness is especially important because these notes may eventually become part of the patient’s medical record. They contain information about the patient’s reported symptoms, observed findings, clinical assessment, and treatment plan. The application must therefore prevent edits from being lost, avoid invalid workflow actions, and clearly show whether changes have been saved.

The project also handles difficult situations such as temporary network loss, multiple edits made before an autosave completes, and two users saving changes based on the same earlier version. Offline changes are queued and replayed after reconnection, autosave removes the need to save manually after every edit, and version conflicts are surfaced through a resolution interface instead of silently overwriting another user’s work.
