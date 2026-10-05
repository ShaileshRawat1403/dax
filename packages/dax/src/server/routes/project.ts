import { PM } from "@/pm"
import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import { Instance } from "../../project/instance"
import { Project } from "../../project/project"
import z from "zod"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { proposeProjectFact, readProjectFactCandidate, reviewProjectFact, ProjectFactChangeSchema } from "@/pm/project-fact-producer"
import { privilegedMutation } from "../transport-security"

export const ProjectRoutes = lazy(() =>
  new Hono()
    .onError((error, c) => {
      if (error.message.startsWith("project_fact_")) return c.json({ error: error.message }, 409)
      throw error
    })
    .get(
      "/",
      describeRoute({
        summary: "List all projects",
        description: "Get a list of projects that have been opened with Dax.",
        operationId: "project.list",
        responses: {
          200: {
            description: "List of projects",
            content: {
              "application/json": {
                schema: resolver(Project.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const projects = await Project.list()
        return c.json(projects)
      },
    )
    .get(
      "/current",
      describeRoute({
        summary: "Get current project",
        description: "Retrieve the currently active project that Dax is working with.",
        operationId: "project.current",
        responses: {
          200: {
            description: "Current project information",
            content: {
              "application/json": {
                schema: resolver(Project.Info),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(Instance.project)
      },
    )
    .get("/settings/review-input", privilegedMutation,
      describeRoute({ summary: "Inspect project settings for explicit operator adoption", operationId: "project.settings.reviewInput" }),
      async (c) => c.json(await PM.settings_review_input({ project_id: Instance.project.id })))
    .post("/facts/candidates", privilegedMutation,
      describeRoute({ summary: "Propose a durable project fact", operationId: "project.fact.propose",
        description: "Creates a non-authoritative candidate and a digest-bound approval request; does not promote it." }),
      validator("json", z.object({ runId: z.string().min(1),
        candidateId: z.string().regex(/^pfc_[0-9a-f]{32}$/), change: ProjectFactChangeSchema }).strict()),
      async (c) => c.json(await proposeProjectFact(c.req.valid("json"))))
    .get("/facts/candidates/:candidateID", privilegedMutation,
      describeRoute({ summary: "Inspect a project fact candidate", operationId: "project.fact.candidate",
        description: "Operator-only inspection of the exact proposed content and review digest." }),
      validator("param", z.object({ candidateID: z.string().regex(/^pfc_[0-9a-f]{32}$/) })),
      async (c) => c.json(await readProjectFactCandidate(c.req.valid("param").candidateID)))
    .post("/facts/candidates/:candidateID/review", privilegedMutation,
      describeRoute({ summary: "Decide a project fact candidate", operationId: "project.fact.review",
        description: "Requires an exact digest confirmation and named operator. Approval is persisted before promotion." }),
      validator("param", z.object({ candidateID: z.string().regex(/^pfc_[0-9a-f]{32}$/) })),
      validator("json", z.object({ digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
        actor: z.string().trim().min(1), decision: z.enum(["approved", "rejected"]) }).strict()),
      async (c) => c.json(await reviewProjectFact({ ...c.req.valid("json"), candidateId: c.req.valid("param").candidateID })))
    .patch(
      "/:projectID",
      privilegedMutation,
      describeRoute({
        summary: "Update project",
        description: "Update project properties such as name, icon, and commands.",
        operationId: "project.update",
        responses: {
          200: {
            description: "Updated project information",
            content: {
              "application/json": {
                schema: resolver(Project.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ projectID: z.string() })),
      validator("json", Project.update.schema.omit({ projectID: true })),
      async (c) => {
        const projectID = c.req.valid("param").projectID
        const body = c.req.valid("json")
        const project = await Project.update({ ...body, projectID })
        return c.json(project)
      },
    ),
)
