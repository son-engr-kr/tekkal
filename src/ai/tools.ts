import { SchemaType } from "@google/generative-ai";
import type { DeckodeTool } from "./geminiClient";

export const deckodeTools: DeckodeTool[] = [
  {
    name: "read_deck",
    description:
      "Read the current deck state including all slides and elements. Use this to understand what exists before making changes.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
    },
  },
  {
    name: "add_slide",
    description:
      "Add a new slide to the deck. Provide the full slide object with id, elements array, and optional fields like background, notes, animations.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slide: {
          type: SchemaType.OBJECT,
          description: "The slide object to add",
          properties: {
            id: { type: SchemaType.STRING, description: "Unique slide ID, e.g. 's3'" },
            background: {
              type: SchemaType.OBJECT,
              properties: {
                color: { type: SchemaType.STRING },
                image: { type: SchemaType.STRING },
              },
            },
            notes: { type: SchemaType.STRING, description: "Speaker notes" },
            elements: {
              type: SchemaType.ARRAY,
              description: "Array of element objects",
              items: { type: SchemaType.OBJECT, properties: {} },
            },
          },
          required: ["id", "elements"],
        },
        afterSlideId: {
          type: SchemaType.STRING,
          description: "Insert after this slide ID. If omitted, appends at end.",
        },
      },
      required: ["slide"],
    },
  },
  {
    name: "update_slide",
    description:
      "Update an existing slide's properties (background, notes, transition). Does NOT modify elements — use update_element for that.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING, description: "ID of the slide to update" },
        patch: {
          type: SchemaType.OBJECT,
          description: "Partial slide fields to update",
          properties: {
            background: {
              type: SchemaType.OBJECT,
              properties: {
                color: { type: SchemaType.STRING },
                image: { type: SchemaType.STRING },
              },
            },
            notes: { type: SchemaType.STRING },
            hidden: { type: SchemaType.BOOLEAN },
            bookmark: { type: SchemaType.STRING },
          },
        },
      },
      required: ["slideId", "patch"],
    },
  },
  {
    name: "delete_slide",
    description: "Delete a slide by its ID.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING, description: "ID of the slide to delete" },
      },
      required: ["slideId"],
    },
  },
  {
    name: "add_element",
    description:
      "Add an element to a specific slide. The element must include type, id, position {x,y}, size {w,h}, and type-specific fields. Canvas is 960x540.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING, description: "Target slide ID" },
        element: {
          type: SchemaType.OBJECT,
          description: "The element object with type, id, position, size, and type-specific fields",
          properties: {},
        },
      },
      required: ["slideId", "element"],
    },
  },
  {
    name: "update_element",
    description: "Update an existing element's properties. Provide only the fields to change.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING, description: "Slide containing the element" },
        elementId: { type: SchemaType.STRING, description: "Element ID to update" },
        patch: {
          type: SchemaType.OBJECT,
          description: "Partial element fields to update",
          properties: {},
        },
      },
      required: ["slideId", "elementId", "patch"],
    },
  },
  {
    name: "delete_element",
    description: "Delete an element from a slide.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        slideId: { type: SchemaType.STRING, description: "Slide containing the element" },
        elementId: { type: SchemaType.STRING, description: "Element ID to delete" },
      },
      required: ["slideId", "elementId"],
    },
  },
  {
    name: "create_deck",
    description:
      "Create a complete new deck, replacing the current one. Use only for full deck generation from scratch.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        deck: {
          type: SchemaType.OBJECT,
          description: "Complete deck object with deckode version, meta, theme, and slides",
          properties: {},
        },
      },
      required: ["deck"],
    },
  },
];

export const plannerTools: DeckodeTool[] = deckodeTools.filter((t) => t.name === "read_deck");

export const generatorTools: DeckodeTool[] = deckodeTools; // all tools

export const reviewerTools: DeckodeTool[] = deckodeTools.filter(
  (t) => t.name === "read_deck" || t.name === "update_element" || t.name === "update_slide" || t.name === "delete_element",
);

export const writerTools: DeckodeTool[] = deckodeTools.filter(
  (t) => t.name === "read_deck" || t.name === "update_slide",
);
