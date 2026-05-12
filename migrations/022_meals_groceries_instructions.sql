-- Migration 022: Update Meals & Groceries project instructions
-- Adds planning-first guidance: lead with a plan, one round of questions max,
-- conversational prose for questions in group chat.

UPDATE projects
SET instructions = instructions || E'\n\nPlanning approach: lead with a concrete plan or draft and refine from feedback rather than asking multiple rounds of clarifying questions before producing anything. One round of questions maximum — make reasonable assumptions and adjust. In group chat, if you need to ask something, ask it as conversational prose, not a bullet-point list.'
WHERE name = 'Meals & Groceries';
