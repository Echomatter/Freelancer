// Reviewed source identity links only. No ratings, scores or source feed are bundled.
// Verified against Models.dev canonical records and Artificial Analysis public
// currentModel.release/creator metadata on 2026-10-04. Names are validation
// assertions; runtime matching uses pinned canonical IDs and configuration UUIDs.
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
export const MODEL_DATA_IDENTITY_REVIEW = freeze({
  verifiedAt: "2026-10-04T01:35:06.771Z",
  modelsDevURL: 'https://models.dev/catalog.json?type=all',
  artificialAnalysisURL: 'https://artificialanalysis.ai/models/claude-sonnet-5-5-high',
  method: 'Reviewed canonical source identity to AA release and configuration UUID.',
});
export const MODEL_DATA_IDENTITIES = freeze(
[
  {
    "canonicalModelID": "alibaba/qwen3-30b-a3b",
    "canonicalName": "Qwen3 30B A3B",
    "canonicalReleaseDate": "2025-04-28",
    "creatorID": "d874d370-74d3-4fa0-ba00-5272f92f946b",
    "creatorName": "Alibaba",
    "creatorSlug": "alibaba",
    "release": {
      "slug": "qwen3-30b-a3b-instruct",
      "name": "Qwen3 30B A3B"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "3e6cf518-a1f4-42d3-8fcf-827c9bd8e6d5",
        "slug": "qwen3-30b-a3b-instruct-reasoning",
        "testedName": "Qwen3 30B A3B (Reasoning)",
        "releaseDate": "2025-04-28",
        "url": "https://artificialanalysis.ai/models/qwen3-30b-a3b-instruct-reasoning"
      },
      {
        "sourceID": "f3169f25-8c6f-48e4-ae87-0cf872dc0ec1",
        "slug": "qwen3-30b-a3b-instruct",
        "testedName": "Qwen3 30B A3B (Non-reasoning)",
        "releaseDate": "2025-04-28",
        "url": "https://artificialanalysis.ai/models/qwen3-30b-a3b-instruct"
      }
    ]
  },
  {
    "canonicalModelID": "alibaba/qwen3-coder-next",
    "canonicalName": "Qwen3 Coder Next",
    "canonicalReleaseDate": "2026-02-03",
    "creatorID": "d874d370-74d3-4fa0-ba00-5272f92f946b",
    "creatorName": "Alibaba",
    "creatorSlug": "alibaba",
    "release": {
      "slug": "qwen3-coder-next",
      "name": "Qwen3 Coder Next"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "fc92f822-04b7-420d-9c07-a21af5e9aac7",
        "slug": "qwen3-coder-next",
        "testedName": "Qwen3 Coder Next",
        "releaseDate": "2026-02-03",
        "url": "https://artificialanalysis.ai/models/qwen3-coder-next"
      }
    ]
  },
  {
    "canonicalModelID": "alibaba/qwen3-max",
    "canonicalName": "Qwen3 Max",
    "canonicalReleaseDate": "2025-09-23",
    "creatorID": "d874d370-74d3-4fa0-ba00-5272f92f946b",
    "creatorName": "Alibaba",
    "creatorSlug": "alibaba",
    "release": {
      "slug": "qwen3-max",
      "name": "Qwen3 Max"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "7ae943a9-9310-4472-a834-c61f0ab68485",
        "slug": "qwen3-max",
        "testedName": "Qwen3 Max",
        "releaseDate": "2025-09-23",
        "url": "https://artificialanalysis.ai/models/qwen3-max"
      }
    ]
  },
  {
    "canonicalModelID": "alibaba/qwen3-vl-235b-a22b-instruct",
    "canonicalName": "Qwen3 VL 235B A22B Instruct",
    "canonicalReleaseDate": "2025-09-23",
    "creatorID": "d874d370-74d3-4fa0-ba00-5272f92f946b",
    "creatorName": "Alibaba",
    "creatorSlug": "alibaba",
    "release": {
      "slug": "qwen3-vl-235b-a22b-instruct",
      "name": "Qwen3 VL 235B A22B Instruct"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "d58cf573-1bd3-4d1f-9182-5482a460f570",
        "slug": "qwen3-vl-235b-a22b-instruct",
        "testedName": "Qwen3 VL 235B A22B Instruct",
        "releaseDate": "2025-09-23",
        "url": "https://artificialanalysis.ai/models/qwen3-vl-235b-a22b-instruct"
      }
    ]
  },
  {
    "canonicalModelID": "alibaba/qwen3.6-27b",
    "canonicalName": "Qwen3.6 27B",
    "canonicalReleaseDate": "2026-04-22",
    "creatorID": "d874d370-74d3-4fa0-ba00-5272f92f946b",
    "creatorName": "Alibaba",
    "creatorSlug": "alibaba",
    "release": {
      "slug": "qwen3-6-27b",
      "name": "Qwen3.6 27B"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "3b156101-b0d7-4438-b350-2d1f1168f40a",
        "slug": "qwen3-6-27b-non-reasoning",
        "testedName": "Qwen3.6 27B (Non-reasoning)",
        "releaseDate": "2026-04-22",
        "url": "https://artificialanalysis.ai/models/qwen3-6-27b-non-reasoning"
      },
      {
        "sourceID": "8c29d66d-bf98-4ea3-8572-5409353ecc66",
        "slug": "qwen3-6-27b",
        "testedName": "Qwen3.6 27B (Reasoning)",
        "releaseDate": "2026-04-22",
        "url": "https://artificialanalysis.ai/models/qwen3-6-27b"
      }
    ]
  },
  {
    "canonicalModelID": "alibaba/qwen3.6-max-preview",
    "canonicalName": "Qwen3.6 Max Preview",
    "canonicalReleaseDate": "2026-04-20",
    "creatorID": "d874d370-74d3-4fa0-ba00-5272f92f946b",
    "creatorName": "Alibaba",
    "creatorSlug": "alibaba",
    "release": {
      "slug": "qwen3-6-max",
      "name": "Qwen3.6 Max Preview"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "6000692c-f9a6-47f8-a5c0-e0874ac488bb",
        "slug": "qwen3-6-max",
        "testedName": "Qwen3.6 Max Preview",
        "releaseDate": "2026-04-20",
        "url": "https://artificialanalysis.ai/models/qwen3-6-max"
      }
    ]
  },
  {
    "canonicalModelID": "alibaba/qwen3.6-plus",
    "canonicalName": "Qwen3.6 Plus",
    "canonicalReleaseDate": "2026-04-02",
    "creatorID": "d874d370-74d3-4fa0-ba00-5272f92f946b",
    "creatorName": "Alibaba",
    "creatorSlug": "alibaba",
    "release": {
      "slug": "qwen3-6-plus",
      "name": "Qwen3.6 Plus"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "f371ad68-6947-4767-a78f-1f6c81f96b93",
        "slug": "qwen3-6-plus",
        "testedName": "Qwen3.6 Plus",
        "releaseDate": "2026-04-02",
        "url": "https://artificialanalysis.ai/models/qwen3-6-plus"
      }
    ]
  },
  {
    "canonicalModelID": "alibaba/qwen3.8-2.4t-a95b",
    "canonicalName": "Qwen3.8 2.4T A95B",
    "canonicalReleaseDate": "2026-08-12",
    "creatorID": "d874d370-74d3-4fa0-ba00-5272f92f946b",
    "creatorName": "Alibaba",
    "creatorSlug": "alibaba",
    "release": {
      "slug": "qwen3-8-2-4t-a95b",
      "name": "Qwen3.8 2.4T A95B"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "8df710d3-9dae-4498-9b4e-9818238e6f31",
        "slug": "qwen3-8-2-4t-a95b",
        "testedName": "Qwen3.8 2.4T A95B",
        "releaseDate": "2026-08-12",
        "url": "https://artificialanalysis.ai/models/qwen3-8-2-4t-a95b"
      }
    ]
  },
  {
    "canonicalModelID": "alibaba/qwen3.8-27b",
    "canonicalName": "Qwen3.8 27B",
    "canonicalReleaseDate": "2026-08-14",
    "creatorID": "d874d370-74d3-4fa0-ba00-5272f92f946b",
    "creatorName": "Alibaba",
    "creatorSlug": "alibaba",
    "release": {
      "slug": "qwen3-8-27b",
      "name": "Qwen3.8 27B"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "353c92f3-2148-4c2d-9231-aa7e1322a1fd",
        "slug": "qwen3-8-27b-non-reasoning",
        "testedName": "Qwen3.8 27B (Non-reasoning)",
        "releaseDate": "2026-08-14",
        "url": "https://artificialanalysis.ai/models/qwen3-8-27b-non-reasoning"
      },
      {
        "sourceID": "6657d7de-a2a9-40bc-a32f-86e80ad63698",
        "slug": "qwen3-8-27b-medium",
        "testedName": "Qwen3.8 27B (Medium)",
        "releaseDate": "2026-08-14",
        "url": "https://artificialanalysis.ai/models/qwen3-8-27b-medium"
      },
      {
        "sourceID": "7e30585f-fad7-40df-a8cb-03c1d96df38a",
        "slug": "qwen3-8-27b-low",
        "testedName": "Qwen3.8 27B (Low)",
        "releaseDate": "2026-08-14",
        "url": "https://artificialanalysis.ai/models/qwen3-8-27b-low"
      },
      {
        "sourceID": "b01dee41-c62b-48ed-8d16-984adc405e5c",
        "slug": "qwen3-8-27b",
        "testedName": "Qwen3.8 27B (Xhigh)",
        "releaseDate": "2026-08-14",
        "url": "https://artificialanalysis.ai/models/qwen3-8-27b"
      }
    ]
  },
  {
    "canonicalModelID": "alibaba/qwen3.8-max",
    "canonicalName": "Qwen3.8 Max",
    "canonicalReleaseDate": "2026-08-03",
    "creatorID": "d874d370-74d3-4fa0-ba00-5272f92f946b",
    "creatorName": "Alibaba",
    "creatorSlug": "alibaba",
    "release": {
      "slug": "qwen3-8-max",
      "name": "Qwen3.8 Max"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "5e5b4ce7-bc54-47b2-b911-21b9cad8394c",
        "slug": "qwen3-8-max-0803",
        "testedName": "Qwen3.8 Max",
        "releaseDate": "2026-08-03",
        "url": "https://artificialanalysis.ai/models/qwen3-8-max-0803"
      }
    ]
  },
  {
    "canonicalModelID": "alibaba/qwq-32b",
    "canonicalName": "QwQ 32B",
    "canonicalReleaseDate": "2025-03-05",
    "creatorID": "d874d370-74d3-4fa0-ba00-5272f92f946b",
    "creatorName": "Alibaba",
    "creatorSlug": "alibaba",
    "release": {
      "slug": "qwq-32b",
      "name": "QwQ 32B"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "ceb4d610-d0a4-48c1-bea0-80ed76f1e5ca",
        "slug": "qwq-32b",
        "testedName": "QwQ 32B",
        "releaseDate": "2025-03-05",
        "url": "https://artificialanalysis.ai/models/qwq-32b"
      }
    ]
  },
  {
    "canonicalModelID": "anthropic/claude-fable-5",
    "canonicalName": "Claude Fable 5",
    "canonicalReleaseDate": "2026-06-09",
    "creatorID": "f0aa413f-e8ae-4fcd-9c48-0e049f4f3128",
    "creatorName": "Anthropic",
    "creatorSlug": "anthropic",
    "release": {
      "slug": "claude-fable-5",
      "name": "Claude Fable 5"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "cd55210d-358e-4df1-ba9c-9acb5f186cc9",
        "slug": "claude-fable-5",
        "testedName": "Claude Fable 5 (Max, Opus 4.8 Fallback)",
        "releaseDate": "2026-06-09",
        "url": "https://artificialanalysis.ai/models/claude-fable-5"
      }
    ]
  },
  {
    "canonicalModelID": "anthropic/claude-fable-5-1",
    "canonicalName": "Claude Fable 5.1",
    "canonicalReleaseDate": "2026-09-01",
    "creatorID": "f0aa413f-e8ae-4fcd-9c48-0e049f4f3128",
    "creatorName": "Anthropic",
    "creatorSlug": "anthropic",
    "release": {
      "slug": "claude-fable-5-1",
      "name": "Claude Fable 5.1"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "05776db7-f5c0-40f7-b824-079160f8cfa8",
        "slug": "claude-fable-5-1-low",
        "testedName": "Claude Fable 5.1 (Low, Default Fallback)",
        "releaseDate": "2026-09-01",
        "url": "https://artificialanalysis.ai/models/claude-fable-5-1-low"
      },
      {
        "sourceID": "3b7de71c-e034-4591-8ca6-6b6be2fa471f",
        "slug": "claude-fable-5-1-medium",
        "testedName": "Claude Fable 5.1 (Medium, Default Fallback)",
        "releaseDate": "2026-09-01",
        "url": "https://artificialanalysis.ai/models/claude-fable-5-1-medium"
      },
      {
        "sourceID": "3e87c73e-a257-495e-9730-367a66229811",
        "slug": "claude-fable-5-1",
        "testedName": "Claude Fable 5.1 (Max, Default Fallback)",
        "releaseDate": "2026-09-01",
        "url": "https://artificialanalysis.ai/models/claude-fable-5-1"
      },
      {
        "sourceID": "9b166bf3-42db-4f63-8338-1c4a1244ffe8",
        "slug": "claude-fable-5-1-xhigh",
        "testedName": "Claude Fable 5.1 (Xhigh, Default Fallback)",
        "releaseDate": "2026-09-01",
        "url": "https://artificialanalysis.ai/models/claude-fable-5-1-xhigh"
      },
      {
        "sourceID": "9d7d72cd-d95d-45a0-b109-4ad292c9aabd",
        "slug": "claude-fable-5-1-high",
        "testedName": "Claude Fable 5.1 (High, Default Fallback)",
        "releaseDate": "2026-09-01",
        "url": "https://artificialanalysis.ai/models/claude-fable-5-1-high"
      }
    ]
  },
  {
    "canonicalModelID": "anthropic/claude-haiku-4-5",
    "canonicalName": "Claude Haiku 4.5 (latest)",
    "canonicalReleaseDate": "2025-10-15",
    "creatorID": "f0aa413f-e8ae-4fcd-9c48-0e049f4f3128",
    "creatorName": "Anthropic",
    "creatorSlug": "anthropic",
    "release": {
      "slug": "claude-4-5-haiku",
      "name": "Claude 4.5 Haiku"
    },
    "reviewNote": "Reviewed display-name difference; creator and release date agree.",
    "configurations": [
      {
        "sourceID": "a6340098-d7ae-462d-b372-0a0a67fc44b4",
        "slug": "claude-4-5-haiku-reasoning",
        "testedName": "Claude 4.5 Haiku (Reasoning)",
        "releaseDate": "2025-10-15",
        "url": "https://artificialanalysis.ai/models/claude-4-5-haiku-reasoning"
      },
      {
        "sourceID": "c2b1e769-7aee-4669-8076-73918bdebf6c",
        "slug": "claude-4-5-haiku",
        "testedName": "Claude 4.5 Haiku (Non-reasoning)",
        "releaseDate": "2025-10-15",
        "url": "https://artificialanalysis.ai/models/claude-4-5-haiku"
      }
    ]
  },
  {
    "canonicalModelID": "anthropic/claude-opus-4-6",
    "canonicalName": "Claude Opus 4.6",
    "canonicalReleaseDate": "2026-02-05",
    "creatorID": "f0aa413f-e8ae-4fcd-9c48-0e049f4f3128",
    "creatorName": "Anthropic",
    "creatorSlug": "anthropic",
    "release": {
      "slug": "claude-opus-4-6",
      "name": "Claude Opus 4.6"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "4386585e-71b4-4a0c-8a63-afb333419cd6",
        "slug": "claude-opus-4-6",
        "testedName": "Claude Opus 4.6 (Non-reasoning, High)",
        "releaseDate": "2026-02-05",
        "url": "https://artificialanalysis.ai/models/claude-opus-4-6"
      },
      {
        "sourceID": "53c98840-47af-49aa-94e6-469fb17e9a1b",
        "slug": "claude-opus-4-6-adaptive",
        "testedName": "Claude Opus 4.6 (Max)",
        "releaseDate": "2026-02-05",
        "url": "https://artificialanalysis.ai/models/claude-opus-4-6-adaptive"
      }
    ]
  },
  {
    "canonicalModelID": "anthropic/claude-opus-4-7",
    "canonicalName": "Claude Opus 4.7",
    "canonicalReleaseDate": "2026-04-16",
    "creatorID": "f0aa413f-e8ae-4fcd-9c48-0e049f4f3128",
    "creatorName": "Anthropic",
    "creatorSlug": "anthropic",
    "release": {
      "slug": "claude-opus-4-7",
      "name": "Claude Opus 4.7"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "2fa8e143-77a8-4d05-bfa8-d3b54634c00f",
        "slug": "claude-opus-4-7-non-reasoning",
        "testedName": "Claude Opus 4.7 (Non-reasoning, High)",
        "releaseDate": "2026-04-16",
        "url": "https://artificialanalysis.ai/models/claude-opus-4-7-non-reasoning"
      },
      {
        "sourceID": "e9a09db3-8fd6-41dd-ba2f-20e0a2bff7f2",
        "slug": "claude-opus-4-7",
        "testedName": "Claude Opus 4.7 (Max)",
        "releaseDate": "2026-04-16",
        "url": "https://artificialanalysis.ai/models/claude-opus-4-7"
      }
    ]
  },
  {
    "canonicalModelID": "anthropic/claude-opus-4-8",
    "canonicalName": "Claude Opus 4.8",
    "canonicalReleaseDate": "2026-05-28",
    "creatorID": "f0aa413f-e8ae-4fcd-9c48-0e049f4f3128",
    "creatorName": "Anthropic",
    "creatorSlug": "anthropic",
    "release": {
      "slug": "claude-opus-4-8",
      "name": "Claude Opus 4.8"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "992b7b84-5069-4c6a-9295-834252553d50",
        "slug": "claude-opus-4-8",
        "testedName": "Claude Opus 4.8 (Max)",
        "releaseDate": "2026-05-28",
        "url": "https://artificialanalysis.ai/models/claude-opus-4-8"
      }
    ]
  },
  {
    "canonicalModelID": "anthropic/claude-opus-5",
    "canonicalName": "Claude Opus 5",
    "canonicalReleaseDate": "2026-07-24",
    "creatorID": "f0aa413f-e8ae-4fcd-9c48-0e049f4f3128",
    "creatorName": "Anthropic",
    "creatorSlug": "anthropic",
    "release": {
      "slug": "claude-opus-5",
      "name": "Claude Opus 5"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "1305c921-7aaa-4d6d-99b5-99b3acf15e19",
        "slug": "claude-opus-5-xhigh",
        "testedName": "Claude Opus 5 (Xhigh)",
        "releaseDate": "2026-07-24",
        "url": "https://artificialanalysis.ai/models/claude-opus-5-xhigh"
      },
      {
        "sourceID": "20928ba9-3a3f-415f-9519-b84ff64ecf34",
        "slug": "claude-opus-5-low",
        "testedName": "Claude Opus 5 (Low)",
        "releaseDate": "2026-07-24",
        "url": "https://artificialanalysis.ai/models/claude-opus-5-low"
      },
      {
        "sourceID": "712be54a-77ae-41b2-9a58-21181479d6ee",
        "slug": "claude-opus-5-high",
        "testedName": "Claude Opus 5 (High)",
        "releaseDate": "2026-07-24",
        "url": "https://artificialanalysis.ai/models/claude-opus-5-high"
      },
      {
        "sourceID": "b8fc61f7-5e9a-49e6-8547-6ac56db24627",
        "slug": "claude-opus-5",
        "testedName": "Claude Opus 5 (Max)",
        "releaseDate": "2026-07-24",
        "url": "https://artificialanalysis.ai/models/claude-opus-5"
      },
      {
        "sourceID": "ff51be8f-e362-4a7e-9043-687ba15de207",
        "slug": "claude-opus-5-medium",
        "testedName": "Claude Opus 5 (Medium)",
        "releaseDate": "2026-07-24",
        "url": "https://artificialanalysis.ai/models/claude-opus-5-medium"
      }
    ]
  },
  {
    "canonicalModelID": "anthropic/claude-opus-5-5",
    "canonicalName": "Claude Opus 5.5",
    "canonicalReleaseDate": "2026-09-22",
    "creatorID": "f0aa413f-e8ae-4fcd-9c48-0e049f4f3128",
    "creatorName": "Anthropic",
    "creatorSlug": "anthropic",
    "release": {
      "slug": "claude-opus-5-5",
      "name": "Claude Opus 5.5"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "2f3c4dc9-a450-4303-8697-0237257cf08f",
        "slug": "claude-opus-5-5",
        "testedName": "Claude Opus 5.5 (Max, Default Fallback)",
        "releaseDate": "2026-09-22",
        "url": "https://artificialanalysis.ai/models/claude-opus-5-5"
      },
      {
        "sourceID": "4416ca93-fde6-4b7b-abbc-3a6be109cc3d",
        "slug": "claude-opus-5-5-low",
        "testedName": "Claude Opus 5.5 (Low, Default Fallback)",
        "releaseDate": "2026-09-22",
        "url": "https://artificialanalysis.ai/models/claude-opus-5-5-low"
      },
      {
        "sourceID": "df5bf99d-d228-4715-b41b-19ca86118777",
        "slug": "claude-opus-5-5-xhigh",
        "testedName": "Claude Opus 5.5 (Xhigh, Default Fallback)",
        "releaseDate": "2026-09-22",
        "url": "https://artificialanalysis.ai/models/claude-opus-5-5-xhigh"
      },
      {
        "sourceID": "ea9e0da6-169f-43c6-92f5-730a10d6ff8d",
        "slug": "claude-opus-5-5-medium",
        "testedName": "Claude Opus 5.5 (Medium, Default Fallback)",
        "releaseDate": "2026-09-22",
        "url": "https://artificialanalysis.ai/models/claude-opus-5-5-medium"
      },
      {
        "sourceID": "f314eade-2232-44bf-a3ab-9b326bc67de6",
        "slug": "claude-opus-5-5-high",
        "testedName": "Claude Opus 5.5 (High, Default Fallback)",
        "releaseDate": "2026-09-22",
        "url": "https://artificialanalysis.ai/models/claude-opus-5-5-high"
      }
    ]
  },
  {
    "canonicalModelID": "anthropic/claude-sonnet-4-6",
    "canonicalName": "Claude Sonnet 4.6",
    "canonicalReleaseDate": "2026-02-17",
    "creatorID": "f0aa413f-e8ae-4fcd-9c48-0e049f4f3128",
    "creatorName": "Anthropic",
    "creatorSlug": "anthropic",
    "release": {
      "slug": "claude-sonnet-4-6",
      "name": "Claude Sonnet 4.6"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "2e40e695-3cec-43da-83f9-615af30b8e91",
        "slug": "claude-sonnet-4-6",
        "testedName": "Claude Sonnet 4.6 (Non-reasoning, High)",
        "releaseDate": "2026-02-17",
        "url": "https://artificialanalysis.ai/models/claude-sonnet-4-6"
      },
      {
        "sourceID": "df8d14e0-3997-4e4d-b4ad-9c047acc9c69",
        "slug": "claude-sonnet-4-6-adaptive",
        "testedName": "Claude Sonnet 4.6 (Max)",
        "releaseDate": "2026-02-17",
        "url": "https://artificialanalysis.ai/models/claude-sonnet-4-6-adaptive"
      },
      {
        "sourceID": "f2e21112-192e-4aed-ae82-68ca3b38e667",
        "slug": "claude-sonnet-4-6-non-reasoning-low-effort",
        "testedName": "Claude Sonnet 4.6 (Non-reasoning, Low)",
        "releaseDate": "2026-02-17",
        "url": "https://artificialanalysis.ai/models/claude-sonnet-4-6-non-reasoning-low-effort"
      }
    ]
  },
  {
    "canonicalModelID": "anthropic/claude-sonnet-5",
    "canonicalName": "Claude Sonnet 5",
    "canonicalReleaseDate": "2026-06-30",
    "creatorID": "f0aa413f-e8ae-4fcd-9c48-0e049f4f3128",
    "creatorName": "Anthropic",
    "creatorSlug": "anthropic",
    "release": {
      "slug": "claude-sonnet-5",
      "name": "Claude Sonnet 5"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "142b93bf-09c4-42dc-9c3a-50b1a222cbd4",
        "slug": "claude-sonnet-5-low",
        "testedName": "Claude Sonnet 5 (Low)",
        "releaseDate": "2026-06-30",
        "url": "https://artificialanalysis.ai/models/claude-sonnet-5-low"
      },
      {
        "sourceID": "23c86e4a-c769-43c0-a056-79e3cd15834f",
        "slug": "claude-sonnet-5",
        "testedName": "Claude Sonnet 5 (Max)",
        "releaseDate": "2026-06-30",
        "url": "https://artificialanalysis.ai/models/claude-sonnet-5"
      },
      {
        "sourceID": "99f376bf-cbcb-4124-bf3e-6b0a4e6e9bea",
        "slug": "claude-sonnet-5-xhigh",
        "testedName": "Claude Sonnet 5 (Xhigh)",
        "releaseDate": "2026-06-30",
        "url": "https://artificialanalysis.ai/models/claude-sonnet-5-xhigh"
      },
      {
        "sourceID": "ba0224cf-0351-4f56-8508-b3f1a740ae4a",
        "slug": "claude-sonnet-5-high",
        "testedName": "Claude Sonnet 5 (High)",
        "releaseDate": "2026-06-30",
        "url": "https://artificialanalysis.ai/models/claude-sonnet-5-high"
      },
      {
        "sourceID": "d58b9ada-fd9d-4fff-a086-242034657963",
        "slug": "claude-sonnet-5-non-reasoning",
        "testedName": "Claude Sonnet 5 (Non-reasoning, High)",
        "releaseDate": "2026-06-30",
        "url": "https://artificialanalysis.ai/models/claude-sonnet-5-non-reasoning"
      },
      {
        "sourceID": "effcd151-7c31-4437-af3d-e88daeae9385",
        "slug": "claude-sonnet-5-medium",
        "testedName": "Claude Sonnet 5 (Medium)",
        "releaseDate": "2026-06-30",
        "url": "https://artificialanalysis.ai/models/claude-sonnet-5-medium"
      }
    ]
  },
  {
    "canonicalModelID": "anthropic/claude-sonnet-5-5",
    "canonicalName": "Claude Sonnet 5.5",
    "canonicalReleaseDate": "2026-09-28",
    "creatorID": "f0aa413f-e8ae-4fcd-9c48-0e049f4f3128",
    "creatorName": "Anthropic",
    "creatorSlug": "anthropic",
    "release": {
      "slug": "claude-sonnet-5-5",
      "name": "Claude Sonnet 5.5"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "042e8a37-fcd0-40f4-8f41-99215fb68eda",
        "slug": "claude-sonnet-5-5-medium",
        "testedName": "Claude Sonnet 5.5 (Medium, Default Fallback)",
        "releaseDate": "2026-09-28",
        "url": "https://artificialanalysis.ai/models/claude-sonnet-5-5-medium"
      },
      {
        "sourceID": "268525e2-f873-4178-bc07-e6a0ee1f002d",
        "slug": "claude-sonnet-5-5-high",
        "testedName": "Claude Sonnet 5.5 (High, Default Fallback)",
        "releaseDate": "2026-09-28",
        "url": "https://artificialanalysis.ai/models/claude-sonnet-5-5-high"
      },
      {
        "sourceID": "975aeaef-50bd-4a65-9c73-f1015adcd4d4",
        "slug": "claude-sonnet-5-5-xhigh",
        "testedName": "Claude Sonnet 5.5 (Xhigh, Default Fallback)",
        "releaseDate": "2026-09-28",
        "url": "https://artificialanalysis.ai/models/claude-sonnet-5-5-xhigh"
      },
      {
        "sourceID": "b171d979-5ec1-45de-b8b9-db1ee65e77ec",
        "slug": "claude-sonnet-5-5",
        "testedName": "Claude Sonnet 5.5 (Max, Default Fallback)",
        "releaseDate": "2026-09-28",
        "url": "https://artificialanalysis.ai/models/claude-sonnet-5-5"
      },
      {
        "sourceID": "bbc2ffea-cf6b-43be-8c41-1769347e234d",
        "slug": "claude-sonnet-5-5-low",
        "testedName": "Claude Sonnet 5.5 (Low, Default Fallback)",
        "releaseDate": "2026-09-28",
        "url": "https://artificialanalysis.ai/models/claude-sonnet-5-5-low"
      }
    ]
  },
  {
    "canonicalModelID": "cohere/command-a-03-2025",
    "canonicalName": "Command A",
    "canonicalReleaseDate": "2025-03-13",
    "creatorID": "671d3708-c407-4b8f-b350-f728e4689d26",
    "creatorName": "Cohere",
    "creatorSlug": "cohere",
    "release": {
      "slug": "command-a",
      "name": "Command A"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "3bc32f13-5afa-4e28-bce1-10e57376686b",
        "slug": "command-a",
        "testedName": "Command A",
        "releaseDate": "2025-03-13",
        "url": "https://artificialanalysis.ai/models/command-a"
      }
    ]
  },
  {
    "canonicalModelID": "cohere/north-mini-code-1-0",
    "canonicalName": "North Mini Code",
    "canonicalReleaseDate": "2026-06-09",
    "creatorID": "671d3708-c407-4b8f-b350-f728e4689d26",
    "creatorName": "Cohere",
    "creatorSlug": "cohere",
    "release": {
      "slug": "north-mini-code",
      "name": "North Mini Code"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "1e9907e0-ffac-4595-b006-962e4f1da7cf",
        "slug": "north-mini-code",
        "testedName": "North Mini Code",
        "releaseDate": "2026-06-09",
        "url": "https://artificialanalysis.ai/models/north-mini-code"
      }
    ]
  },
  {
    "canonicalModelID": "cohere/tiny-aya-global",
    "canonicalName": "Tiny Aya Global",
    "canonicalReleaseDate": "2026-02-17",
    "creatorID": "671d3708-c407-4b8f-b350-f728e4689d26",
    "creatorName": "Cohere",
    "creatorSlug": "cohere",
    "release": {
      "slug": "tiny-aya-global",
      "name": "Tiny Aya Global"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "81444bc8-72f9-4a2d-ad43-27e3f0d2f461",
        "slug": "tiny-aya-global",
        "testedName": "Tiny Aya Global",
        "releaseDate": "2026-02-17",
        "url": "https://artificialanalysis.ai/models/tiny-aya-global"
      }
    ]
  },
  {
    "canonicalModelID": "deepseek/deepseek-v3.2",
    "canonicalName": "DeepSeek V3.2",
    "canonicalReleaseDate": "2025-12-01",
    "creatorID": "58b835bf-4c87-4f87-a846-df4b692c6e7d",
    "creatorName": "DeepSeek",
    "creatorSlug": "deepseek",
    "release": {
      "slug": "deepseek-v3-2",
      "name": "DeepSeek V3.2"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "6d9a176d-feb8-4dac-8872-afe32b31897f",
        "slug": "deepseek-v3-2",
        "testedName": "DeepSeek V3.2 (Non-reasoning)",
        "releaseDate": "2025-12-01",
        "url": "https://artificialanalysis.ai/models/deepseek-v3-2"
      },
      {
        "sourceID": "d621247c-d47e-458c-82cb-a166bc3b37e5",
        "slug": "deepseek-v3-2-reasoning",
        "testedName": "DeepSeek V3.2 (Reasoning)",
        "releaseDate": "2025-12-01",
        "url": "https://artificialanalysis.ai/models/deepseek-v3-2-reasoning"
      }
    ]
  },
  {
    "canonicalModelID": "deepseek/deepseek-v4-flash-0731",
    "canonicalName": "DeepSeek V4 Flash 0731",
    "canonicalReleaseDate": "2026-07-31",
    "creatorID": "58b835bf-4c87-4f87-a846-df4b692c6e7d",
    "creatorName": "DeepSeek",
    "creatorSlug": "deepseek",
    "release": {
      "slug": "deepseek-v4-flash",
      "name": "DeepSeek V4 Flash 0731"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "fe4c0848-e284-4e52-a79d-cdc28392f1a9",
        "slug": "deepseek-v4-flash",
        "testedName": "DeepSeek V4 Flash 0731 (Max)",
        "releaseDate": "2026-07-31",
        "url": "https://artificialanalysis.ai/models/deepseek-v4-flash"
      }
    ]
  },
  {
    "canonicalModelID": "deepseek/deepseek-v4.1-flash",
    "canonicalName": "DeepSeek V4.1 Flash",
    "canonicalReleaseDate": "2026-09-10",
    "creatorID": "58b835bf-4c87-4f87-a846-df4b692c6e7d",
    "creatorName": "DeepSeek",
    "creatorSlug": "deepseek",
    "release": {
      "slug": "deepseek-v4-1-flash",
      "name": "DeepSeek V4.1 Flash"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "73c96f99-0de3-4668-a4bd-b106a0fe18f2",
        "slug": "deepseek-v4-1-flash-non-reasoning",
        "testedName": "DeepSeek V4.1 Flash (Non-reasoning)",
        "releaseDate": "2026-09-10",
        "url": "https://artificialanalysis.ai/models/deepseek-v4-1-flash-non-reasoning"
      },
      {
        "sourceID": "dbe7c625-3100-4463-b479-a228c41f75dd",
        "slug": "deepseek-v4-1-flash",
        "testedName": "DeepSeek V4.1 Flash (Max)",
        "releaseDate": "2026-09-10",
        "url": "https://artificialanalysis.ai/models/deepseek-v4-1-flash"
      }
    ]
  },
  {
    "canonicalModelID": "google/gemini-2.5-flash-lite",
    "canonicalName": "Gemini 2.5 Flash-Lite",
    "canonicalReleaseDate": "2025-06-17",
    "creatorID": "faddc6d9-2c14-445f-9b28-56726f59c793",
    "creatorName": "Google",
    "creatorSlug": "google",
    "release": {
      "slug": "gemini-2-5-flash-lite",
      "name": "Gemini 2.5 Flash-Lite"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "1d81aa1c-64c8-442a-9c41-81b37e407b91",
        "slug": "gemini-2-5-flash-lite",
        "testedName": "Gemini 2.5 Flash-Lite (Non-reasoning)",
        "releaseDate": "2025-06-17",
        "url": "https://artificialanalysis.ai/models/gemini-2-5-flash-lite"
      },
      {
        "sourceID": "f4e8194a-d0e6-48eb-92be-4307de5aeeec",
        "slug": "gemini-2-5-flash-lite-reasoning",
        "testedName": "Gemini 2.5 Flash-Lite (Reasoning)",
        "releaseDate": "2025-06-17",
        "url": "https://artificialanalysis.ai/models/gemini-2-5-flash-lite-reasoning"
      }
    ]
  },
  {
    "canonicalModelID": "google/gemini-3-flash-preview",
    "canonicalName": "Gemini 3 Flash Preview",
    "canonicalReleaseDate": "2025-12-17",
    "creatorID": "faddc6d9-2c14-445f-9b28-56726f59c793",
    "creatorName": "Google",
    "creatorSlug": "google",
    "release": {
      "slug": "gemini-3-flash-preview",
      "name": "Gemini 3 Flash Preview"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "783a0ea2-1eef-422a-8c3d-f6d40d943f54",
        "slug": "gemini-3-flash",
        "testedName": "Gemini 3 Flash Preview (Non-reasoning)",
        "releaseDate": "2025-12-17",
        "url": "https://artificialanalysis.ai/models/gemini-3-flash"
      },
      {
        "sourceID": "7c73c3be-7f51-4d14-bec8-d5789488df25",
        "slug": "gemini-3-flash-reasoning",
        "testedName": "Gemini 3 Flash Preview (Reasoning)",
        "releaseDate": "2025-12-17",
        "url": "https://artificialanalysis.ai/models/gemini-3-flash-reasoning"
      }
    ]
  },
  {
    "canonicalModelID": "google/gemini-3-pro-preview",
    "canonicalName": "Gemini 3 Pro Preview",
    "canonicalReleaseDate": "2025-11-18",
    "creatorID": "faddc6d9-2c14-445f-9b28-56726f59c793",
    "creatorName": "Google",
    "creatorSlug": "google",
    "release": {
      "slug": "gemini-3-pro-preview",
      "name": "Gemini 3 Pro Preview"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "b2f3191f-77d6-4155-8be6-330f0baa1ae5",
        "slug": "gemini-3-pro-low",
        "testedName": "Gemini 3 Pro Preview (Low)",
        "releaseDate": "2025-11-18",
        "url": "https://artificialanalysis.ai/models/gemini-3-pro-low"
      },
      {
        "sourceID": "d1122eff-ee85-4fdc-8a9f-23bee6590667",
        "slug": "gemini-3-pro",
        "testedName": "Gemini 3 Pro Preview (High)",
        "releaseDate": "2025-11-18",
        "url": "https://artificialanalysis.ai/models/gemini-3-pro"
      }
    ]
  },
  {
    "canonicalModelID": "google/gemini-3.1-pro-preview",
    "canonicalName": "Gemini 3.1 Pro Preview",
    "canonicalReleaseDate": "2026-02-19",
    "creatorID": "faddc6d9-2c14-445f-9b28-56726f59c793",
    "creatorName": "Google",
    "creatorSlug": "google",
    "release": {
      "slug": "gemini-3-1-pro-preview",
      "name": "Gemini 3.1 Pro Preview"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "bbd93ebe-80da-4594-bb19-61e69d0331df",
        "slug": "gemini-3-1-pro-preview",
        "testedName": "Gemini 3.1 Pro Preview",
        "releaseDate": "2026-02-19",
        "url": "https://artificialanalysis.ai/models/gemini-3-1-pro-preview"
      }
    ]
  },
  {
    "canonicalModelID": "google/gemini-3.5-flash",
    "canonicalName": "Gemini 3.5 Flash",
    "canonicalReleaseDate": "2026-05-19",
    "creatorID": "faddc6d9-2c14-445f-9b28-56726f59c793",
    "creatorName": "Google",
    "creatorSlug": "google",
    "release": {
      "slug": "gemini-3-5-flash",
      "name": "Gemini 3.5 Flash"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "0097ebf5-124f-42f6-9463-33b00e711f03",
        "slug": "gemini-3-5-flash",
        "testedName": "Gemini 3.5 Flash (High)",
        "releaseDate": "2026-05-19",
        "url": "https://artificialanalysis.ai/models/gemini-3-5-flash"
      },
      {
        "sourceID": "033ade17-d9ec-44e0-b792-b5f1fcd5ab4c",
        "slug": "gemini-3-5-flash-minimal",
        "testedName": "Gemini 3.5 Flash (Minimal)",
        "releaseDate": "2026-05-19",
        "url": "https://artificialanalysis.ai/models/gemini-3-5-flash-minimal"
      },
      {
        "sourceID": "5016ea75-7b0e-4737-a7e6-1062c6d90fd4",
        "slug": "gemini-3-5-flash-medium",
        "testedName": "Gemini 3.5 Flash (Medium)",
        "releaseDate": "2026-05-19",
        "url": "https://artificialanalysis.ai/models/gemini-3-5-flash-medium"
      }
    ]
  },
  {
    "canonicalModelID": "google/gemini-3.6-flash",
    "canonicalName": "Gemini 3.6 Flash",
    "canonicalReleaseDate": "2026-07-21",
    "creatorID": "faddc6d9-2c14-445f-9b28-56726f59c793",
    "creatorName": "Google",
    "creatorSlug": "google",
    "release": {
      "slug": "gemini-3-6-flash",
      "name": "Gemini 3.6 Flash"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "78332c88-fe60-42c8-af9d-3617e44cf1f5",
        "slug": "gemini-3-6-flash",
        "testedName": "Gemini 3.6 Flash (High)",
        "releaseDate": "2026-07-21",
        "url": "https://artificialanalysis.ai/models/gemini-3-6-flash"
      }
    ]
  },
  {
    "canonicalModelID": "google/gemini-3.7-flash",
    "canonicalName": "Gemini 3.7 Flash",
    "canonicalReleaseDate": "2026-08-13",
    "creatorID": "faddc6d9-2c14-445f-9b28-56726f59c793",
    "creatorName": "Google",
    "creatorSlug": "google",
    "release": {
      "slug": "gemini-3-7-flash",
      "name": "Gemini 3.7 Flash"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "b2331108-72ed-415a-82d1-188633875bbc",
        "slug": "gemini-3-7-flash",
        "testedName": "Gemini 3.7 Flash (High)",
        "releaseDate": "2026-08-13",
        "url": "https://artificialanalysis.ai/models/gemini-3-7-flash"
      },
      {
        "sourceID": "ddfdaf64-3f8e-40a6-a492-608ee83a1351",
        "slug": "gemini-3-7-flash-low",
        "testedName": "Gemini 3.7 Flash (Low)",
        "releaseDate": "2026-08-13",
        "url": "https://artificialanalysis.ai/models/gemini-3-7-flash-low"
      },
      {
        "sourceID": "eb0d4272-7204-42b9-b875-8866fed58548",
        "slug": "gemini-3-7-flash-medium",
        "testedName": "Gemini 3.7 Flash (Medium)",
        "releaseDate": "2026-08-13",
        "url": "https://artificialanalysis.ai/models/gemini-3-7-flash-medium"
      }
    ]
  },
  {
    "canonicalModelID": "google/gemini-3.8-flash",
    "canonicalName": "Gemini 3.8 Flash",
    "canonicalReleaseDate": "2026-09-02",
    "creatorID": "faddc6d9-2c14-445f-9b28-56726f59c793",
    "creatorName": "Google",
    "creatorSlug": "google",
    "release": {
      "slug": "gemini-3-8-flash",
      "name": "Gemini 3.8 Flash"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "744fa3c1-42a7-4995-b138-fb6be11f463c",
        "slug": "gemini-3-8-flash-medium",
        "testedName": "Gemini 3.8 Flash (Medium)",
        "releaseDate": "2026-09-02",
        "url": "https://artificialanalysis.ai/models/gemini-3-8-flash-medium"
      },
      {
        "sourceID": "8a999846-4c1d-4ce7-a8b7-1310a7166fd7",
        "slug": "gemini-3-8-flash",
        "testedName": "Gemini 3.8 Flash (High)",
        "releaseDate": "2026-09-02",
        "url": "https://artificialanalysis.ai/models/gemini-3-8-flash"
      },
      {
        "sourceID": "f6db039b-0f3b-485c-9d7f-982988e44f26",
        "slug": "gemini-3-8-flash-low",
        "testedName": "Gemini 3.8 Flash (Low)",
        "releaseDate": "2026-09-02",
        "url": "https://artificialanalysis.ai/models/gemini-3-8-flash-low"
      }
    ]
  },
  {
    "canonicalModelID": "inclusionai/ling-3.1-flash",
    "canonicalName": "Ling 3.1 Flash",
    "canonicalReleaseDate": "2026-09-29",
    "creatorID": "4df238a9-d4fd-4cf2-ab1e-d12956c41f9b",
    "creatorName": "InclusionAI",
    "creatorSlug": "inclusionai",
    "release": {
      "slug": "ling-3-1-flash",
      "name": "Ling 3.1 Flash"
    },
    "reviewNote": "Source-specific release dates differ; both are retained separately.",
    "configurations": [
      {
        "sourceID": "a6043b9b-628a-4a76-a021-2834e0627d05",
        "slug": "ling-3-1-flash",
        "testedName": "Ling 3.1 Flash",
        "releaseDate": "2026-10-01",
        "url": "https://artificialanalysis.ai/models/ling-3-1-flash"
      }
    ]
  },
  {
    "canonicalModelID": "meta/muse-spark-1.2",
    "canonicalName": "Muse Spark 1.2",
    "canonicalReleaseDate": "2026-08-05",
    "creatorID": "e1694725-0192-4e54-b1b8-c97e816c6cbe",
    "creatorName": "Meta",
    "creatorSlug": "meta",
    "release": {
      "slug": "muse-spark-1-2",
      "name": "Muse Spark 1.2"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "04ee6719-0327-463b-a1a1-70a6a78254f9",
        "slug": "muse-spark-1-2",
        "testedName": "Muse Spark 1.2 (Xhigh)",
        "releaseDate": "2026-08-05",
        "url": "https://artificialanalysis.ai/models/muse-spark-1-2"
      }
    ]
  },
  {
    "canonicalModelID": "meta/muse-spark-1.3",
    "canonicalName": "Muse Spark 1.3",
    "canonicalReleaseDate": "2026-09-02",
    "creatorID": "e1694725-0192-4e54-b1b8-c97e816c6cbe",
    "creatorName": "Meta",
    "creatorSlug": "meta",
    "release": {
      "slug": "muse-spark-1-3",
      "name": "Muse Spark 1.3"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "9999672c-b687-4026-9c15-5cef02ff53bb",
        "slug": "muse-spark-1-3",
        "testedName": "Muse Spark 1.3 (Max)",
        "releaseDate": "2026-09-02",
        "url": "https://artificialanalysis.ai/models/muse-spark-1-3"
      },
      {
        "sourceID": "d5170215-69be-4129-849b-26d8d8825bfc",
        "slug": "muse-spark-1-3-xhigh",
        "testedName": "Muse Spark 1.3 (Xhigh)",
        "releaseDate": "2026-09-02",
        "url": "https://artificialanalysis.ai/models/muse-spark-1-3-xhigh"
      }
    ]
  },
  {
    "canonicalModelID": "minimax/MiniMax-M2.1",
    "canonicalName": "MiniMax-M2.1",
    "canonicalReleaseDate": "2025-12-23",
    "creatorID": "a31a9071-6144-4dbb-92dc-2e02d653ecea",
    "creatorName": "MiniMax",
    "creatorSlug": "minimax",
    "release": {
      "slug": "minimax-m2-1",
      "name": "MiniMax-M2.1"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "272ff333-442f-4169-a804-ac9177bc99d7",
        "slug": "minimax-m2-1",
        "testedName": "MiniMax-M2.1",
        "releaseDate": "2025-12-23",
        "url": "https://artificialanalysis.ai/models/minimax-m2-1"
      }
    ]
  },
  {
    "canonicalModelID": "minimax/MiniMax-M2.5",
    "canonicalName": "MiniMax-M2.5",
    "canonicalReleaseDate": "2026-02-12",
    "creatorID": "a31a9071-6144-4dbb-92dc-2e02d653ecea",
    "creatorName": "MiniMax",
    "creatorSlug": "minimax",
    "release": {
      "slug": "minimax-m2-5",
      "name": "MiniMax-M2.5"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "12adec16-19fe-4d92-aeff-5ef3eb7e780a",
        "slug": "minimax-m2-5",
        "testedName": "MiniMax-M2.5",
        "releaseDate": "2026-02-12",
        "url": "https://artificialanalysis.ai/models/minimax-m2-5"
      }
    ]
  },
  {
    "canonicalModelID": "minimax/MiniMax-M2.7",
    "canonicalName": "MiniMax-M2.7",
    "canonicalReleaseDate": "2026-03-18",
    "creatorID": "a31a9071-6144-4dbb-92dc-2e02d653ecea",
    "creatorName": "MiniMax",
    "creatorSlug": "minimax",
    "release": {
      "slug": "minimax-m2-7",
      "name": "MiniMax-M2.7"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "4bbceacb-cf47-464b-b60f-e1d1fe016d67",
        "slug": "minimax-m2-7",
        "testedName": "MiniMax-M2.7",
        "releaseDate": "2026-03-18",
        "url": "https://artificialanalysis.ai/models/minimax-m2-7"
      }
    ]
  },
  {
    "canonicalModelID": "minimax/MiniMax-M3",
    "canonicalName": "MiniMax-M3",
    "canonicalReleaseDate": "2026-06-01",
    "creatorID": "a31a9071-6144-4dbb-92dc-2e02d653ecea",
    "creatorName": "MiniMax",
    "creatorSlug": "minimax",
    "release": {
      "slug": "minimax-m3",
      "name": "MiniMax-M3"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "277f939a-985b-4b37-859d-b3eabc7c0b26",
        "slug": "minimax-m3",
        "testedName": "MiniMax-M3",
        "releaseDate": "2026-06-01",
        "url": "https://artificialanalysis.ai/models/minimax-m3"
      }
    ]
  },
  {
    "canonicalModelID": "mistral/devstral-2512",
    "canonicalName": "Devstral 2",
    "canonicalReleaseDate": "2025-12-09",
    "creatorID": "b5c0639a-cc9c-443b-a07e-bae6b7088933",
    "creatorName": "Mistral",
    "creatorSlug": "mistral",
    "release": {
      "slug": "devstral-2",
      "name": "Devstral 2"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "09f43999-b67b-4c1b-b050-44df41ed7e62",
        "slug": "devstral-2",
        "testedName": "Devstral 2",
        "releaseDate": "2025-12-09",
        "url": "https://artificialanalysis.ai/models/devstral-2"
      }
    ]
  },
  {
    "canonicalModelID": "mistral/devstral-medium-2507",
    "canonicalName": "Devstral Medium",
    "canonicalReleaseDate": "2025-07-10",
    "creatorID": "b5c0639a-cc9c-443b-a07e-bae6b7088933",
    "creatorName": "Mistral",
    "creatorSlug": "mistral",
    "release": {
      "slug": "devstral-medium",
      "name": "Devstral Medium"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "aba82268-2bb7-4a0f-80be-9b7722e2145b",
        "slug": "devstral-medium",
        "testedName": "Devstral Medium",
        "releaseDate": "2025-07-10",
        "url": "https://artificialanalysis.ai/models/devstral-medium"
      }
    ]
  },
  {
    "canonicalModelID": "mistral/devstral-small-2",
    "canonicalName": "Devstral Small 2",
    "canonicalReleaseDate": "2025-12-09",
    "creatorID": "b5c0639a-cc9c-443b-a07e-bae6b7088933",
    "creatorName": "Mistral",
    "creatorSlug": "mistral",
    "release": {
      "slug": "devstral-small-2",
      "name": "Devstral Small 2"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "ce819310-af7c-49d3-9a02-6845111e1788",
        "slug": "devstral-small-2",
        "testedName": "Devstral Small 2",
        "releaseDate": "2025-12-09",
        "url": "https://artificialanalysis.ai/models/devstral-small-2"
      }
    ]
  },
  {
    "canonicalModelID": "mistral/ministral-3-14b-instruct-2512",
    "canonicalName": "Ministral 3 14B",
    "canonicalReleaseDate": "2025-12-02",
    "creatorID": "b5c0639a-cc9c-443b-a07e-bae6b7088933",
    "creatorName": "Mistral",
    "creatorSlug": "mistral",
    "release": {
      "slug": "ministral-3-14b",
      "name": "Ministral 3 14B"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "713fae11-c75c-4f10-ae2c-8e4074cd58af",
        "slug": "ministral-3-14b",
        "testedName": "Ministral 3 14B",
        "releaseDate": "2025-12-02",
        "url": "https://artificialanalysis.ai/models/ministral-3-14b"
      }
    ]
  },
  {
    "canonicalModelID": "mistral/ministral-3-3b-instruct-2512",
    "canonicalName": "Ministral 3 3B",
    "canonicalReleaseDate": "2025-12-02",
    "creatorID": "b5c0639a-cc9c-443b-a07e-bae6b7088933",
    "creatorName": "Mistral",
    "creatorSlug": "mistral",
    "release": {
      "slug": "ministral-3-3b",
      "name": "Ministral 3 3B"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "66f4ce73-9a9b-4b49-9c6e-bedb9bfdc720",
        "slug": "ministral-3-3b",
        "testedName": "Ministral 3 3B",
        "releaseDate": "2025-12-02",
        "url": "https://artificialanalysis.ai/models/ministral-3-3b"
      }
    ]
  },
  {
    "canonicalModelID": "mistral/ministral-3-8b-instruct-2512",
    "canonicalName": "Ministral 3 8B",
    "canonicalReleaseDate": "2025-12-02",
    "creatorID": "b5c0639a-cc9c-443b-a07e-bae6b7088933",
    "creatorName": "Mistral",
    "creatorSlug": "mistral",
    "release": {
      "slug": "ministral-3-8b",
      "name": "Ministral 3 8B"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "9741f3c2-cbb1-4a3f-99ee-7bd7384d9038",
        "slug": "ministral-3-8b",
        "testedName": "Ministral 3 8B",
        "releaseDate": "2025-12-02",
        "url": "https://artificialanalysis.ai/models/ministral-3-8b"
      }
    ]
  },
  {
    "canonicalModelID": "mistral/mistral-large-2512",
    "canonicalName": "Mistral Large 3",
    "canonicalReleaseDate": "2025-12-02",
    "creatorID": "b5c0639a-cc9c-443b-a07e-bae6b7088933",
    "creatorName": "Mistral",
    "creatorSlug": "mistral",
    "release": {
      "slug": "mistral-large-3",
      "name": "Mistral Large 3"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "4928e950-7f37-4475-b0dc-c5bad781a321",
        "slug": "mistral-large-3",
        "testedName": "Mistral Large 3",
        "releaseDate": "2025-12-02",
        "url": "https://artificialanalysis.ai/models/mistral-large-3"
      }
    ]
  },
  {
    "canonicalModelID": "mistral/mistral-medium-2505",
    "canonicalName": "Mistral Medium 3",
    "canonicalReleaseDate": "2025-05-07",
    "creatorID": "b5c0639a-cc9c-443b-a07e-bae6b7088933",
    "creatorName": "Mistral",
    "creatorSlug": "mistral",
    "release": {
      "slug": "mistral-medium-3",
      "name": "Mistral Medium 3"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "59e22326-1bca-4432-a5fa-147fbe8854e7",
        "slug": "mistral-medium-3",
        "testedName": "Mistral Medium 3",
        "releaseDate": "2025-05-07",
        "url": "https://artificialanalysis.ai/models/mistral-medium-3"
      }
    ]
  },
  {
    "canonicalModelID": "mistral/mistral-medium-2604",
    "canonicalName": "Mistral Medium 3.5",
    "canonicalReleaseDate": "2026-04-29",
    "creatorID": "b5c0639a-cc9c-443b-a07e-bae6b7088933",
    "creatorName": "Mistral",
    "creatorSlug": "mistral",
    "release": {
      "slug": "mistral-medium-3-5",
      "name": "Mistral Medium 3.5"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "dd059b25-d82a-4ead-82a4-4adceaaec48b",
        "slug": "mistral-medium-3-5",
        "testedName": "Mistral Medium 3.5",
        "releaseDate": "2026-04-29",
        "url": "https://artificialanalysis.ai/models/mistral-medium-3-5"
      }
    ]
  },
  {
    "canonicalModelID": "mistral/mistral-small-2506",
    "canonicalName": "Mistral Small 3.2",
    "canonicalReleaseDate": "2025-06-20",
    "creatorID": "b5c0639a-cc9c-443b-a07e-bae6b7088933",
    "creatorName": "Mistral",
    "creatorSlug": "mistral",
    "release": {
      "slug": "mistral-small-3-2",
      "name": "Mistral Small 3.2"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "43da3718-3d6e-40dd-901a-05664179ff7f",
        "slug": "mistral-small-3-2",
        "testedName": "Mistral Small 3.2",
        "releaseDate": "2025-06-20",
        "url": "https://artificialanalysis.ai/models/mistral-small-3-2"
      }
    ]
  },
  {
    "canonicalModelID": "mistral/mistral-small-2603",
    "canonicalName": "Mistral Small 4",
    "canonicalReleaseDate": "2026-03-16",
    "creatorID": "b5c0639a-cc9c-443b-a07e-bae6b7088933",
    "creatorName": "Mistral",
    "creatorSlug": "mistral",
    "release": {
      "slug": "mistral-small-4",
      "name": "Mistral Small 4"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "12f6a061-0ab3-4c76-b225-49abee253651",
        "slug": "mistral-small-4-non-reasoning",
        "testedName": "Mistral Small 4 (Non-reasoning)",
        "releaseDate": "2026-03-16",
        "url": "https://artificialanalysis.ai/models/mistral-small-4-non-reasoning"
      },
      {
        "sourceID": "3fd96175-4ef1-434c-8795-f873aec2abc1",
        "slug": "mistral-small-4",
        "testedName": "Mistral Small 4 (Reasoning)",
        "releaseDate": "2026-03-16",
        "url": "https://artificialanalysis.ai/models/mistral-small-4"
      }
    ]
  },
  {
    "canonicalModelID": "moonshotai/kimi-k2-thinking",
    "canonicalName": "Kimi K2 Thinking",
    "canonicalReleaseDate": "2025-11-06",
    "creatorID": "0a177021-87dd-4250-9a37-f01df196bfe0",
    "creatorName": "Kimi",
    "creatorSlug": "kimi",
    "release": {
      "slug": "kimi-k2-thinking",
      "name": "Kimi K2 Thinking"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "bddebfd3-0a8d-47f5-b722-bc4c2ca5a5dc",
        "slug": "kimi-k2-thinking",
        "testedName": "Kimi K2 Thinking",
        "releaseDate": "2025-11-06",
        "url": "https://artificialanalysis.ai/models/kimi-k2-thinking"
      }
    ]
  },
  {
    "canonicalModelID": "moonshotai/kimi-k2.7-code",
    "canonicalName": "Kimi K2.7 Code",
    "canonicalReleaseDate": "2026-06-12",
    "creatorID": "0a177021-87dd-4250-9a37-f01df196bfe0",
    "creatorName": "Kimi",
    "creatorSlug": "kimi",
    "release": {
      "slug": "kimi-k2-7-code",
      "name": "Kimi K2.7 Code"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "8d0cb231-7303-452c-9923-a9620b948475",
        "slug": "kimi-k2-7-code",
        "testedName": "Kimi K2.7 Code",
        "releaseDate": "2026-06-12",
        "url": "https://artificialanalysis.ai/models/kimi-k2-7-code"
      }
    ]
  },
  {
    "canonicalModelID": "moonshotai/kimi-k3",
    "canonicalName": "Kimi K3",
    "canonicalReleaseDate": "2026-07-16",
    "creatorID": "0a177021-87dd-4250-9a37-f01df196bfe0",
    "creatorName": "Kimi",
    "creatorSlug": "kimi",
    "release": {
      "slug": "kimi-k3",
      "name": "Kimi K3"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "512d17ef-13d2-4f65-bf9b-154b0dec7e8d",
        "slug": "kimi-k3-low",
        "testedName": "Kimi K3 (Low)",
        "releaseDate": "2026-07-16",
        "url": "https://artificialanalysis.ai/models/kimi-k3-low"
      },
      {
        "sourceID": "f7d2fc3e-1f7b-405f-818c-07952a4af78f",
        "slug": "kimi-k3",
        "testedName": "Kimi K3 (Max)",
        "releaseDate": "2026-07-16",
        "url": "https://artificialanalysis.ai/models/kimi-k3"
      }
    ]
  },
  {
    "canonicalModelID": "nvidia/nemotron-3-super-120b-a12b",
    "canonicalName": "Nemotron 3 Super 120B A12B",
    "canonicalReleaseDate": "2026-03-11",
    "creatorID": "0c303112-430d-4367-a484-51defaa2e166",
    "creatorName": "NVIDIA",
    "creatorSlug": "nvidia",
    "release": {
      "slug": "nvidia-nemotron-3-super-120b-a12b",
      "name": "Nemotron 3 Super 120B A12B"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "63872e9c-3377-4a6b-b477-7bba244c38e9",
        "slug": "nvidia-nemotron-3-super-120b-a12b",
        "testedName": "Nemotron 3 Super 120B A12B (Reasoning)",
        "releaseDate": "2026-03-11",
        "url": "https://artificialanalysis.ai/models/nvidia-nemotron-3-super-120b-a12b"
      }
    ]
  },
  {
    "canonicalModelID": "nvidia/nemotron-3-ultra-550b-a55b",
    "canonicalName": "Nemotron 3 Ultra 550B A55B",
    "canonicalReleaseDate": "2026-06-04",
    "creatorID": "0c303112-430d-4367-a484-51defaa2e166",
    "creatorName": "NVIDIA",
    "creatorSlug": "nvidia",
    "release": {
      "slug": "nemotron-3-ultra-550b-a55b",
      "name": "Nemotron 3 Ultra 550B A55B"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "5b52def2-ac9b-4465-ad80-91ea8079e253",
        "slug": "nvidia-nemotron-3-ultra-550b-a55b",
        "testedName": "Nemotron 3 Ultra 550B A55B (Reasoning)",
        "releaseDate": "2026-06-04",
        "url": "https://artificialanalysis.ai/models/nvidia-nemotron-3-ultra-550b-a55b"
      }
    ]
  },
  {
    "canonicalModelID": "nvidia/nemotron-3.5-lightning",
    "canonicalName": "Nemotron 3.5 Lightning 30B A3B",
    "canonicalReleaseDate": "2026-08-11",
    "creatorID": "0c303112-430d-4367-a484-51defaa2e166",
    "creatorName": "NVIDIA",
    "creatorSlug": "nvidia",
    "release": {
      "slug": "nemotron-3-5-lightning",
      "name": "Nemotron 3.5 Lightning"
    },
    "reviewNote": "Reviewed display-name difference; creator and release date agree.",
    "configurations": [
      {
        "sourceID": "29976311-665a-4b2f-ac72-557c33e0758e",
        "slug": "nemotron-3-5-lightning",
        "testedName": "Nemotron 3.5 Lightning",
        "releaseDate": "2026-08-11",
        "url": "https://artificialanalysis.ai/models/nemotron-3-5-lightning"
      }
    ]
  },
  {
    "canonicalModelID": "openai/gpt-4-turbo",
    "canonicalName": "GPT-4 Turbo",
    "canonicalReleaseDate": "2023-11-06",
    "creatorID": "e67e56e3-15cd-43db-b679-da4660a69f41",
    "creatorName": "OpenAI",
    "creatorSlug": "openai",
    "release": {
      "slug": "gpt-4-turbo",
      "name": "GPT-4 Turbo"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "76aa6af5-fdc6-4739-a300-983f14e74a67",
        "slug": "gpt-4-turbo",
        "testedName": "GPT-4 Turbo",
        "releaseDate": "2023-11-06",
        "url": "https://artificialanalysis.ai/models/gpt-4-turbo"
      }
    ]
  },
  {
    "canonicalModelID": "openai/gpt-4.1",
    "canonicalName": "GPT-4.1",
    "canonicalReleaseDate": "2025-04-14",
    "creatorID": "e67e56e3-15cd-43db-b679-da4660a69f41",
    "creatorName": "OpenAI",
    "creatorSlug": "openai",
    "release": {
      "slug": "gpt-4-1",
      "name": "GPT-4.1"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "3b608b70-6434-4baa-99ad-45d499703c67",
        "slug": "gpt-4-1",
        "testedName": "GPT-4.1",
        "releaseDate": "2025-04-14",
        "url": "https://artificialanalysis.ai/models/gpt-4-1"
      }
    ]
  },
  {
    "canonicalModelID": "openai/gpt-4.1-mini",
    "canonicalName": "GPT-4.1 mini",
    "canonicalReleaseDate": "2025-04-14",
    "creatorID": "e67e56e3-15cd-43db-b679-da4660a69f41",
    "creatorName": "OpenAI",
    "creatorSlug": "openai",
    "release": {
      "slug": "gpt-4-1-mini",
      "name": "GPT-4.1 mini"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "9f7c7566-a704-49a2-a383-cb3181da33a4",
        "slug": "gpt-4-1-mini",
        "testedName": "GPT-4.1 mini",
        "releaseDate": "2025-04-14",
        "url": "https://artificialanalysis.ai/models/gpt-4-1-mini"
      }
    ]
  },
  {
    "canonicalModelID": "openai/gpt-4.1-nano",
    "canonicalName": "GPT-4.1 nano",
    "canonicalReleaseDate": "2025-04-14",
    "creatorID": "e67e56e3-15cd-43db-b679-da4660a69f41",
    "creatorName": "OpenAI",
    "creatorSlug": "openai",
    "release": {
      "slug": "gpt-4-1-nano",
      "name": "GPT-4.1 nano"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "72c358fd-7d45-4d68-89aa-699743710924",
        "slug": "gpt-4-1-nano",
        "testedName": "GPT-4.1 nano",
        "releaseDate": "2025-04-14",
        "url": "https://artificialanalysis.ai/models/gpt-4-1-nano"
      }
    ]
  },
  {
    "canonicalModelID": "openai/gpt-4o-mini",
    "canonicalName": "GPT-4o mini",
    "canonicalReleaseDate": "2024-07-18",
    "creatorID": "e67e56e3-15cd-43db-b679-da4660a69f41",
    "creatorName": "OpenAI",
    "creatorSlug": "openai",
    "release": {
      "slug": "gpt-4o-mini",
      "name": "GPT-4o mini"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "b5c1c91a-7474-4409-9a9c-9c2ac45d9eb6",
        "slug": "gpt-4o-mini",
        "testedName": "GPT-4o mini",
        "releaseDate": "2024-07-18",
        "url": "https://artificialanalysis.ai/models/gpt-4o-mini"
      }
    ]
  },
  {
    "canonicalModelID": "openai/gpt-5",
    "canonicalName": "GPT-5",
    "canonicalReleaseDate": "2025-08-07",
    "creatorID": "e67e56e3-15cd-43db-b679-da4660a69f41",
    "creatorName": "OpenAI",
    "creatorSlug": "openai",
    "release": {
      "slug": "gpt-5",
      "name": "GPT-5"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "48e50f00-1fd1-4acc-b337-61078aa341e6",
        "slug": "gpt-5",
        "testedName": "GPT-5 (High)",
        "releaseDate": "2025-08-07",
        "url": "https://artificialanalysis.ai/models/gpt-5"
      },
      {
        "sourceID": "5e965af0-ca5c-4f47-9ba9-06000508b84a",
        "slug": "gpt-5-medium",
        "testedName": "GPT-5 (Medium)",
        "releaseDate": "2025-08-07",
        "url": "https://artificialanalysis.ai/models/gpt-5-medium"
      },
      {
        "sourceID": "7f3c9423-3ee3-4369-a6d9-3f2a40aff00e",
        "slug": "gpt-5-low",
        "testedName": "GPT-5 (Low)",
        "releaseDate": "2025-08-07",
        "url": "https://artificialanalysis.ai/models/gpt-5-low"
      },
      {
        "sourceID": "c3738fb0-3408-4430-a699-760ae4b70c93",
        "slug": "gpt-5-minimal",
        "testedName": "GPT-5 (Minimal)",
        "releaseDate": "2025-08-07",
        "url": "https://artificialanalysis.ai/models/gpt-5-minimal"
      }
    ]
  },
  {
    "canonicalModelID": "openai/gpt-5-mini",
    "canonicalName": "GPT-5 Mini",
    "canonicalReleaseDate": "2025-08-07",
    "creatorID": "e67e56e3-15cd-43db-b679-da4660a69f41",
    "creatorName": "OpenAI",
    "creatorSlug": "openai",
    "release": {
      "slug": "gpt-5-mini",
      "name": "GPT-5 mini"
    },
    "reviewNote": "Reviewed display-name difference; creator and release date agree.",
    "configurations": [
      {
        "sourceID": "29855680-7469-43eb-8b88-cd3fb1d99da3",
        "slug": "gpt-5-mini",
        "testedName": "GPT-5 mini (High)",
        "releaseDate": "2025-08-07",
        "url": "https://artificialanalysis.ai/models/gpt-5-mini"
      },
      {
        "sourceID": "bc26bfdb-4923-4442-a6ca-e77392923581",
        "slug": "gpt-5-mini-minimal",
        "testedName": "GPT-5 mini (Minimal)",
        "releaseDate": "2025-08-07",
        "url": "https://artificialanalysis.ai/models/gpt-5-mini-minimal"
      },
      {
        "sourceID": "c3274a19-6d3c-4d01-ab9b-5055a0a40429",
        "slug": "gpt-5-mini-medium",
        "testedName": "GPT-5 mini (Medium)",
        "releaseDate": "2025-08-07",
        "url": "https://artificialanalysis.ai/models/gpt-5-mini-medium"
      }
    ]
  },
  {
    "canonicalModelID": "openai/gpt-5.1",
    "canonicalName": "GPT-5.1",
    "canonicalReleaseDate": "2025-11-13",
    "creatorID": "e67e56e3-15cd-43db-b679-da4660a69f41",
    "creatorName": "OpenAI",
    "creatorSlug": "openai",
    "release": {
      "slug": "gpt-5-1",
      "name": "GPT-5.1"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "4dc12a38-b18f-4c43-8e1b-678f8434b5b1",
        "slug": "gpt-5-1",
        "testedName": "GPT-5.1 (High)",
        "releaseDate": "2025-11-13",
        "url": "https://artificialanalysis.ai/models/gpt-5-1"
      },
      {
        "sourceID": "d0b3d47e-aec6-425e-9de7-168dcc6d1e28",
        "slug": "gpt-5-1-non-reasoning",
        "testedName": "GPT-5.1 (Non-reasoning)",
        "releaseDate": "2025-11-13",
        "url": "https://artificialanalysis.ai/models/gpt-5-1-non-reasoning"
      }
    ]
  },
  {
    "canonicalModelID": "openai/gpt-5.1-codex",
    "canonicalName": "GPT-5.1 Codex",
    "canonicalReleaseDate": "2025-11-13",
    "creatorID": "e67e56e3-15cd-43db-b679-da4660a69f41",
    "creatorName": "OpenAI",
    "creatorSlug": "openai",
    "release": {
      "slug": "gpt-5-1-codex",
      "name": "GPT-5.1 Codex"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "04d023f3-025c-4d78-9571-53edda3eaf2a",
        "slug": "gpt-5-1-codex",
        "testedName": "GPT-5.1 Codex (High)",
        "releaseDate": "2025-11-13",
        "url": "https://artificialanalysis.ai/models/gpt-5-1-codex"
      }
    ]
  },
  {
    "canonicalModelID": "openai/gpt-5.1-codex-mini",
    "canonicalName": "GPT-5.1 Codex mini",
    "canonicalReleaseDate": "2025-11-13",
    "creatorID": "e67e56e3-15cd-43db-b679-da4660a69f41",
    "creatorName": "OpenAI",
    "creatorSlug": "openai",
    "release": {
      "slug": "gpt-5-1-codex-mini",
      "name": "GPT-5.1 Codex mini"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "fd4454ff-e703-46c0-a7f5-fa69af09486d",
        "slug": "gpt-5-1-codex-mini",
        "testedName": "GPT-5.1 Codex mini (High)",
        "releaseDate": "2025-11-13",
        "url": "https://artificialanalysis.ai/models/gpt-5-1-codex-mini"
      }
    ]
  },
  {
    "canonicalModelID": "openai/gpt-5.2",
    "canonicalName": "GPT-5.2",
    "canonicalReleaseDate": "2025-12-11",
    "creatorID": "e67e56e3-15cd-43db-b679-da4660a69f41",
    "creatorName": "OpenAI",
    "creatorSlug": "openai",
    "release": {
      "slug": "gpt-5-2",
      "name": "GPT-5.2"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "498862c3-f9ac-49d2-852f-16a02bb0c38f",
        "slug": "gpt-5-2",
        "testedName": "GPT-5.2 (Xhigh)",
        "releaseDate": "2025-12-11",
        "url": "https://artificialanalysis.ai/models/gpt-5-2"
      },
      {
        "sourceID": "6dd8ba55-5680-44a9-b309-82928165d5f0",
        "slug": "gpt-5-2-non-reasoning",
        "testedName": "GPT-5.2 (Non-reasoning)",
        "releaseDate": "2025-12-11",
        "url": "https://artificialanalysis.ai/models/gpt-5-2-non-reasoning"
      },
      {
        "sourceID": "84e3f11e-d659-4941-8988-1dbfabbaf538",
        "slug": "gpt-5-2-medium",
        "testedName": "GPT-5.2 (Medium)",
        "releaseDate": "2025-12-11",
        "url": "https://artificialanalysis.ai/models/gpt-5-2-medium"
      }
    ]
  },
  {
    "canonicalModelID": "openai/gpt-5.2-codex",
    "canonicalName": "GPT-5.2 Codex",
    "canonicalReleaseDate": "2025-12-11",
    "creatorID": "e67e56e3-15cd-43db-b679-da4660a69f41",
    "creatorName": "OpenAI",
    "creatorSlug": "openai",
    "release": {
      "slug": "gpt-5-2-codex",
      "name": "GPT-5.2 Codex"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "019e86f6-e66b-42d8-8a50-235a06b53003",
        "slug": "gpt-5-2-codex",
        "testedName": "GPT-5.2 Codex (Xhigh)",
        "releaseDate": "2025-12-11",
        "url": "https://artificialanalysis.ai/models/gpt-5-2-codex"
      }
    ]
  },
  {
    "canonicalModelID": "openai/gpt-5.3-codex",
    "canonicalName": "GPT-5.3 Codex",
    "canonicalReleaseDate": "2026-02-05",
    "creatorID": "e67e56e3-15cd-43db-b679-da4660a69f41",
    "creatorName": "OpenAI",
    "creatorSlug": "openai",
    "release": {
      "slug": "gpt-5-3-codex",
      "name": "GPT-5.3 Codex"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "59b5b14b-5365-4ee7-824a-18a8e6309644",
        "slug": "gpt-5-3-codex",
        "testedName": "GPT-5.3 Codex (Xhigh)",
        "releaseDate": "2026-02-05",
        "url": "https://artificialanalysis.ai/models/gpt-5-3-codex"
      }
    ]
  },
  {
    "canonicalModelID": "openai/gpt-5.4",
    "canonicalName": "GPT-5.4",
    "canonicalReleaseDate": "2026-03-05",
    "creatorID": "e67e56e3-15cd-43db-b679-da4660a69f41",
    "creatorName": "OpenAI",
    "creatorSlug": "openai",
    "release": {
      "slug": "gpt-5-4",
      "name": "GPT-5.4"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "493f6a1e-7717-4e98-9d6f-548b92c4702d",
        "slug": "gpt-5-4-non-reasoning",
        "testedName": "GPT-5.4 (Non-reasoning)",
        "releaseDate": "2026-03-05",
        "url": "https://artificialanalysis.ai/models/gpt-5-4-non-reasoning"
      },
      {
        "sourceID": "538e945c-6c27-4fd3-995d-ded80a36cd10",
        "slug": "gpt-5-4-low",
        "testedName": "GPT-5.4 (Low)",
        "releaseDate": "2026-03-05",
        "url": "https://artificialanalysis.ai/models/gpt-5-4-low"
      },
      {
        "sourceID": "a89c4b28-2d8c-456e-88ea-255fb51fd2b6",
        "slug": "gpt-5-4",
        "testedName": "GPT-5.4 (Xhigh)",
        "releaseDate": "2026-03-05",
        "url": "https://artificialanalysis.ai/models/gpt-5-4"
      }
    ]
  },
  {
    "canonicalModelID": "openai/gpt-5.4-mini",
    "canonicalName": "GPT-5.4 mini",
    "canonicalReleaseDate": "2026-03-17",
    "creatorID": "e67e56e3-15cd-43db-b679-da4660a69f41",
    "creatorName": "OpenAI",
    "creatorSlug": "openai",
    "release": {
      "slug": "gpt-5-4-mini",
      "name": "GPT-5.4 mini"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "392063ba-c3b5-47e8-ba67-a7b0b34f6824",
        "slug": "gpt-5-4-mini-medium",
        "testedName": "GPT-5.4 mini (Medium)",
        "releaseDate": "2026-03-17",
        "url": "https://artificialanalysis.ai/models/gpt-5-4-mini-medium"
      },
      {
        "sourceID": "ae447455-940d-4d30-9139-a664fa896eaf",
        "slug": "gpt-5-4-mini-non-reasoning",
        "testedName": "GPT-5.4 mini (Non-reasoning)",
        "releaseDate": "2026-03-17",
        "url": "https://artificialanalysis.ai/models/gpt-5-4-mini-non-reasoning"
      },
      {
        "sourceID": "ba242e40-83b7-4cd3-a0e0-b56237984914",
        "slug": "gpt-5-4-mini",
        "testedName": "GPT-5.4 mini (Xhigh)",
        "releaseDate": "2026-03-17",
        "url": "https://artificialanalysis.ai/models/gpt-5-4-mini"
      }
    ]
  },
  {
    "canonicalModelID": "openai/gpt-5.4-nano",
    "canonicalName": "GPT-5.4 nano",
    "canonicalReleaseDate": "2026-03-17",
    "creatorID": "e67e56e3-15cd-43db-b679-da4660a69f41",
    "creatorName": "OpenAI",
    "creatorSlug": "openai",
    "release": {
      "slug": "gpt-5-4-nano",
      "name": "GPT-5.4 nano"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "8869f28a-a6ff-487f-8d32-93fe335fdda5",
        "slug": "gpt-5-4-nano-medium",
        "testedName": "GPT-5.4 nano (Medium)",
        "releaseDate": "2026-03-17",
        "url": "https://artificialanalysis.ai/models/gpt-5-4-nano-medium"
      },
      {
        "sourceID": "c298d1a8-606c-4971-8613-ccdaaf941043",
        "slug": "gpt-5-4-nano-non-reasoning",
        "testedName": "GPT-5.4 nano (Non-reasoning)",
        "releaseDate": "2026-03-17",
        "url": "https://artificialanalysis.ai/models/gpt-5-4-nano-non-reasoning"
      },
      {
        "sourceID": "d4fc3f33-f2b0-4da1-88ee-f1f82bd4de31",
        "slug": "gpt-5-4-nano",
        "testedName": "GPT-5.4 nano (Xhigh)",
        "releaseDate": "2026-03-17",
        "url": "https://artificialanalysis.ai/models/gpt-5-4-nano"
      }
    ]
  },
  {
    "canonicalModelID": "openai/gpt-5.4-pro",
    "canonicalName": "GPT-5.4 Pro",
    "canonicalReleaseDate": "2026-03-05",
    "creatorID": "e67e56e3-15cd-43db-b679-da4660a69f41",
    "creatorName": "OpenAI",
    "creatorSlug": "openai",
    "release": {
      "slug": "gpt-5-4-pro",
      "name": "GPT-5.4 Pro"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "5bb1f426-2d64-4d03-99fb-8041ee85c33b",
        "slug": "gpt-5-4-pro",
        "testedName": "GPT-5.4 Pro (Xhigh)",
        "releaseDate": "2026-03-05",
        "url": "https://artificialanalysis.ai/models/gpt-5-4-pro"
      }
    ]
  },
  {
    "canonicalModelID": "openai/gpt-5.5",
    "canonicalName": "GPT-5.5",
    "canonicalReleaseDate": "2026-04-23",
    "creatorID": "e67e56e3-15cd-43db-b679-da4660a69f41",
    "creatorName": "OpenAI",
    "creatorSlug": "openai",
    "release": {
      "slug": "gpt-5-5",
      "name": "GPT-5.5"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "1f054429-397e-4fdb-9e71-67bc92c1735e",
        "slug": "gpt-5-5",
        "testedName": "GPT-5.5 (Xhigh)",
        "releaseDate": "2026-04-23",
        "url": "https://artificialanalysis.ai/models/gpt-5-5"
      },
      {
        "sourceID": "6b79f899-e3c0-45f6-923c-243faccdb2fc",
        "slug": "gpt-5-5-medium",
        "testedName": "GPT-5.5 (Medium)",
        "releaseDate": "2026-04-23",
        "url": "https://artificialanalysis.ai/models/gpt-5-5-medium"
      },
      {
        "sourceID": "6f1a7562-6e96-46ac-af4f-6ba5a7a3da96",
        "slug": "gpt-5-5-non-reasoning",
        "testedName": "GPT-5.5 (Non-reasoning)",
        "releaseDate": "2026-04-23",
        "url": "https://artificialanalysis.ai/models/gpt-5-5-non-reasoning"
      },
      {
        "sourceID": "b13c1257-d746-4027-8fc8-4892dc14701c",
        "slug": "gpt-5-5-high",
        "testedName": "GPT-5.5 (High)",
        "releaseDate": "2026-04-23",
        "url": "https://artificialanalysis.ai/models/gpt-5-5-high"
      },
      {
        "sourceID": "c77cfe51-f4a0-4692-9dee-5061ef667f23",
        "slug": "gpt-5-5-low",
        "testedName": "GPT-5.5 (Low)",
        "releaseDate": "2026-04-23",
        "url": "https://artificialanalysis.ai/models/gpt-5-5-low"
      }
    ]
  },
  {
    "canonicalModelID": "openai/gpt-5.5-pro",
    "canonicalName": "GPT-5.5 Pro",
    "canonicalReleaseDate": "2026-04-23",
    "creatorID": "e67e56e3-15cd-43db-b679-da4660a69f41",
    "creatorName": "OpenAI",
    "creatorSlug": "openai",
    "release": {
      "slug": "gpt-5-5-pro",
      "name": "GPT-5.5 Pro"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "e3396f8f-7994-4df5-bdab-43745681ef0a",
        "slug": "gpt-5-5-pro",
        "testedName": "GPT-5.5 Pro (Xhigh)",
        "releaseDate": "2026-04-23",
        "url": "https://artificialanalysis.ai/models/gpt-5-5-pro"
      }
    ]
  },
  {
    "canonicalModelID": "openai/gpt-5.6-luna",
    "canonicalName": "GPT-5.6 Luna",
    "canonicalReleaseDate": "2026-07-09",
    "creatorID": "e67e56e3-15cd-43db-b679-da4660a69f41",
    "creatorName": "OpenAI",
    "creatorSlug": "openai",
    "release": {
      "slug": "gpt-5-6-luna",
      "name": "GPT-5.6 Luna"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "050c61cd-cddc-463a-a30a-a82aaa37be59",
        "slug": "gpt-5-6-luna-low",
        "testedName": "GPT-5.6 Luna (Low)",
        "releaseDate": "2026-07-09",
        "url": "https://artificialanalysis.ai/models/gpt-5-6-luna-low"
      },
      {
        "sourceID": "426d24c8-49ae-482a-b4a8-20f1c53f21c1",
        "slug": "gpt-5-6-luna",
        "testedName": "GPT-5.6 Luna (Max)",
        "releaseDate": "2026-07-09",
        "url": "https://artificialanalysis.ai/models/gpt-5-6-luna"
      },
      {
        "sourceID": "58b812bf-8498-46db-b834-f43ccc614b61",
        "slug": "gpt-5-6-luna-medium",
        "testedName": "GPT-5.6 Luna (Medium)",
        "releaseDate": "2026-07-09",
        "url": "https://artificialanalysis.ai/models/gpt-5-6-luna-medium"
      },
      {
        "sourceID": "87110ff0-1f79-41b4-9976-eda250597317",
        "slug": "gpt-5-6-luna-xhigh",
        "testedName": "GPT-5.6 Luna (Xhigh)",
        "releaseDate": "2026-07-09",
        "url": "https://artificialanalysis.ai/models/gpt-5-6-luna-xhigh"
      },
      {
        "sourceID": "aa55297e-8fbf-4372-b4ab-9b068dc6396c",
        "slug": "gpt-5-6-luna-high",
        "testedName": "GPT-5.6 Luna (High)",
        "releaseDate": "2026-07-09",
        "url": "https://artificialanalysis.ai/models/gpt-5-6-luna-high"
      },
      {
        "sourceID": "dc64f856-3ded-497d-9527-d41d31267ed5",
        "slug": "gpt-5-6-luna-non-reasoning",
        "testedName": "GPT-5.6 Luna (Non-reasoning)",
        "releaseDate": "2026-07-09",
        "url": "https://artificialanalysis.ai/models/gpt-5-6-luna-non-reasoning"
      }
    ]
  },
  {
    "canonicalModelID": "openai/gpt-5.6-sol",
    "canonicalName": "GPT-5.6 Sol",
    "canonicalReleaseDate": "2026-07-09",
    "creatorID": "e67e56e3-15cd-43db-b679-da4660a69f41",
    "creatorName": "OpenAI",
    "creatorSlug": "openai",
    "release": {
      "slug": "gpt-5-6-sol",
      "name": "GPT-5.6 Sol"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "0904b596-8932-43bd-9b21-324f128e1723",
        "slug": "gpt-5-6-sol-low",
        "testedName": "GPT-5.6 Sol (Low)",
        "releaseDate": "2026-07-09",
        "url": "https://artificialanalysis.ai/models/gpt-5-6-sol-low"
      },
      {
        "sourceID": "6f174934-5b7d-4333-86cb-f5ebf4a862e3",
        "slug": "gpt-5-6-sol-medium",
        "testedName": "GPT-5.6 Sol (Medium)",
        "releaseDate": "2026-07-09",
        "url": "https://artificialanalysis.ai/models/gpt-5-6-sol-medium"
      },
      {
        "sourceID": "7c4d1e30-6ecb-46cf-880c-41446d7b51f1",
        "slug": "gpt-5-6-sol-non-reasoning",
        "testedName": "GPT-5.6 Sol (Non-reasoning)",
        "releaseDate": "2026-07-09",
        "url": "https://artificialanalysis.ai/models/gpt-5-6-sol-non-reasoning"
      },
      {
        "sourceID": "8afc250d-b538-45a2-812a-4605f4ffd87e",
        "slug": "gpt-5-6-sol-high",
        "testedName": "GPT-5.6 Sol (High)",
        "releaseDate": "2026-07-09",
        "url": "https://artificialanalysis.ai/models/gpt-5-6-sol-high"
      },
      {
        "sourceID": "d93edfe8-bf35-49ad-b56e-b18116142a1c",
        "slug": "gpt-5-6-sol",
        "testedName": "GPT-5.6 Sol (Max)",
        "releaseDate": "2026-07-09",
        "url": "https://artificialanalysis.ai/models/gpt-5-6-sol"
      },
      {
        "sourceID": "d998db47-9b67-4727-a2bb-2e1261020ac0",
        "slug": "gpt-5-6-sol-xhigh",
        "testedName": "GPT-5.6 Sol (Xhigh)",
        "releaseDate": "2026-07-09",
        "url": "https://artificialanalysis.ai/models/gpt-5-6-sol-xhigh"
      }
    ]
  },
  {
    "canonicalModelID": "openai/gpt-5.6-terra",
    "canonicalName": "GPT-5.6 Terra",
    "canonicalReleaseDate": "2026-07-09",
    "creatorID": "e67e56e3-15cd-43db-b679-da4660a69f41",
    "creatorName": "OpenAI",
    "creatorSlug": "openai",
    "release": {
      "slug": "gpt-5-6-terra",
      "name": "GPT-5.6 Terra"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "26e0f83a-ca98-4f34-94ac-7c5e251ee410",
        "slug": "gpt-5-6-terra-medium",
        "testedName": "GPT-5.6 Terra (Medium)",
        "releaseDate": "2026-07-09",
        "url": "https://artificialanalysis.ai/models/gpt-5-6-terra-medium"
      },
      {
        "sourceID": "81972fba-1219-477e-bbfb-18c656a63ff7",
        "slug": "gpt-5-6-terra-high",
        "testedName": "GPT-5.6 Terra (High)",
        "releaseDate": "2026-07-09",
        "url": "https://artificialanalysis.ai/models/gpt-5-6-terra-high"
      },
      {
        "sourceID": "9b97a35e-6ac7-44d9-91c6-422fa678963e",
        "slug": "gpt-5-6-terra-non-reasoning",
        "testedName": "GPT-5.6 Terra (Non-reasoning)",
        "releaseDate": "2026-07-09",
        "url": "https://artificialanalysis.ai/models/gpt-5-6-terra-non-reasoning"
      },
      {
        "sourceID": "9e30696f-16fa-4b4f-ba53-161895a85fed",
        "slug": "gpt-5-6-terra-xhigh",
        "testedName": "GPT-5.6 Terra (Xhigh)",
        "releaseDate": "2026-07-09",
        "url": "https://artificialanalysis.ai/models/gpt-5-6-terra-xhigh"
      },
      {
        "sourceID": "bcf8db0a-3bb6-4d82-9516-0f57370c85a6",
        "slug": "gpt-5-6-terra",
        "testedName": "GPT-5.6 Terra (Max)",
        "releaseDate": "2026-07-09",
        "url": "https://artificialanalysis.ai/models/gpt-5-6-terra"
      },
      {
        "sourceID": "cc4a20cd-09fe-4962-a430-119c815e85fa",
        "slug": "gpt-5-6-terra-low",
        "testedName": "GPT-5.6 Terra (Low)",
        "releaseDate": "2026-07-09",
        "url": "https://artificialanalysis.ai/models/gpt-5-6-terra-low"
      }
    ]
  },
  {
    "canonicalModelID": "openai/gpt-6-astra",
    "canonicalName": "GPT-6 Astra",
    "canonicalReleaseDate": "2026-09-04",
    "creatorID": "e67e56e3-15cd-43db-b679-da4660a69f41",
    "creatorName": "OpenAI",
    "creatorSlug": "openai",
    "release": {
      "slug": "gpt-6-astra",
      "name": "GPT-6 Astra"
    },
    "reviewNote": "Source-specific release dates differ; both are retained separately.",
    "configurations": [
      {
        "sourceID": "1f541ef3-913f-4eb2-9d07-0e93c7a9a5e3",
        "slug": "gpt-6-astra-xhigh",
        "testedName": "GPT-6 Astra (Xhigh)",
        "releaseDate": "2026-09-03",
        "url": "https://artificialanalysis.ai/models/gpt-6-astra-xhigh"
      },
      {
        "sourceID": "2f339a97-9a0d-499a-9cb5-e0db665bfa25",
        "slug": "gpt-6-astra",
        "testedName": "GPT-6 Astra (Max)",
        "releaseDate": "2026-09-03",
        "url": "https://artificialanalysis.ai/models/gpt-6-astra"
      },
      {
        "sourceID": "a3f8100d-e38f-408b-b0fa-0085dae18dc1",
        "slug": "gpt-6-astra-low",
        "testedName": "GPT-6 Astra (Low)",
        "releaseDate": "2026-09-03",
        "url": "https://artificialanalysis.ai/models/gpt-6-astra-low"
      },
      {
        "sourceID": "e05a4828-0536-4876-870d-a235023f992b",
        "slug": "gpt-6-astra-high",
        "testedName": "GPT-6 Astra (High)",
        "releaseDate": "2026-09-03",
        "url": "https://artificialanalysis.ai/models/gpt-6-astra-high"
      },
      {
        "sourceID": "e97a4ef5-e817-480e-9595-12f81dc4974f",
        "slug": "gpt-6-astra-medium",
        "testedName": "GPT-6 Astra (Medium)",
        "releaseDate": "2026-09-03",
        "url": "https://artificialanalysis.ai/models/gpt-6-astra-medium"
      }
    ]
  },
  {
    "canonicalModelID": "openai/gpt-6-luna",
    "canonicalName": "GPT-6 Luna",
    "canonicalReleaseDate": "2026-09-22",
    "creatorID": "e67e56e3-15cd-43db-b679-da4660a69f41",
    "creatorName": "OpenAI",
    "creatorSlug": "openai",
    "release": {
      "slug": "gpt-6-luna",
      "name": "GPT-6 Luna"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "19813eb2-460a-475c-af65-810bb8660fec",
        "slug": "gpt-6-luna-xhigh",
        "testedName": "GPT-6 Luna (Xhigh)",
        "releaseDate": "2026-09-22",
        "url": "https://artificialanalysis.ai/models/gpt-6-luna-xhigh"
      },
      {
        "sourceID": "36667da0-9222-4967-adbb-f7efa15ad213",
        "slug": "gpt-6-luna-medium",
        "testedName": "GPT-6 Luna (Medium)",
        "releaseDate": "2026-09-22",
        "url": "https://artificialanalysis.ai/models/gpt-6-luna-medium"
      },
      {
        "sourceID": "63cb48ea-0b0c-4e07-8ded-6d28dec4fa28",
        "slug": "gpt-6-luna-non-reasoning",
        "testedName": "GPT-6 Luna (Non-reasoning)",
        "releaseDate": "2026-09-22",
        "url": "https://artificialanalysis.ai/models/gpt-6-luna-non-reasoning"
      },
      {
        "sourceID": "6fb13851-40ce-4bda-ad3f-6b38e0c5daa7",
        "slug": "gpt-6-luna",
        "testedName": "GPT-6 Luna (Max)",
        "releaseDate": "2026-09-22",
        "url": "https://artificialanalysis.ai/models/gpt-6-luna"
      },
      {
        "sourceID": "7d1229bc-deea-4717-ba5b-f59a35d991e3",
        "slug": "gpt-6-luna-high",
        "testedName": "GPT-6 Luna (High)",
        "releaseDate": "2026-09-22",
        "url": "https://artificialanalysis.ai/models/gpt-6-luna-high"
      },
      {
        "sourceID": "bf9708d8-933d-44f6-affa-b696a7a650c9",
        "slug": "gpt-6-luna-low",
        "testedName": "GPT-6 Luna (Low)",
        "releaseDate": "2026-09-22",
        "url": "https://artificialanalysis.ai/models/gpt-6-luna-low"
      }
    ]
  },
  {
    "canonicalModelID": "openai/gpt-6-sol",
    "canonicalName": "GPT-6 Sol",
    "canonicalReleaseDate": "2026-09-22",
    "creatorID": "e67e56e3-15cd-43db-b679-da4660a69f41",
    "creatorName": "OpenAI",
    "creatorSlug": "openai",
    "release": {
      "slug": "gpt-6-sol",
      "name": "GPT-6 Sol"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "01459872-433a-4ab2-8e99-7083162172eb",
        "slug": "gpt-6-sol-low",
        "testedName": "GPT-6 Sol (Low)",
        "releaseDate": "2026-09-22",
        "url": "https://artificialanalysis.ai/models/gpt-6-sol-low"
      },
      {
        "sourceID": "52eebe3e-6ede-4e46-92db-c5dea49fc410",
        "slug": "gpt-6-sol-high",
        "testedName": "GPT-6 Sol (High)",
        "releaseDate": "2026-09-22",
        "url": "https://artificialanalysis.ai/models/gpt-6-sol-high"
      },
      {
        "sourceID": "780a4a85-17ff-4175-a8dd-ebca4823e61b",
        "slug": "gpt-6-sol-medium",
        "testedName": "GPT-6 Sol (Medium)",
        "releaseDate": "2026-09-22",
        "url": "https://artificialanalysis.ai/models/gpt-6-sol-medium"
      },
      {
        "sourceID": "c50ea08c-88c0-4eb7-85b8-27f2bbf6d527",
        "slug": "gpt-6-sol",
        "testedName": "GPT-6 Sol (Max)",
        "releaseDate": "2026-09-22",
        "url": "https://artificialanalysis.ai/models/gpt-6-sol"
      },
      {
        "sourceID": "d3e20e76-9e1a-45b6-b809-ad6aa37430cf",
        "slug": "gpt-6-sol-non-reasoning",
        "testedName": "GPT-6 Sol (Non-reasoning)",
        "releaseDate": "2026-09-22",
        "url": "https://artificialanalysis.ai/models/gpt-6-sol-non-reasoning"
      },
      {
        "sourceID": "da2642fe-9f73-4788-b5af-24edcd55b37e",
        "slug": "gpt-6-sol-xhigh",
        "testedName": "GPT-6 Sol (Xhigh)",
        "releaseDate": "2026-09-22",
        "url": "https://artificialanalysis.ai/models/gpt-6-sol-xhigh"
      }
    ]
  },
  {
    "canonicalModelID": "openai/gpt-6.1-sol",
    "canonicalName": "GPT-6.1 Sol",
    "canonicalReleaseDate": "2026-09-29",
    "creatorID": "e67e56e3-15cd-43db-b679-da4660a69f41",
    "creatorName": "OpenAI",
    "creatorSlug": "openai",
    "release": {
      "slug": "gpt-6-1-sol",
      "name": "GPT-6.1 Sol"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "092a3b0e-c5c8-45dc-bf1b-53673c8ff352",
        "slug": "gpt-6-1-sol-xhigh",
        "testedName": "GPT-6.1 Sol (Xhigh)",
        "releaseDate": "2026-09-29",
        "url": "https://artificialanalysis.ai/models/gpt-6-1-sol-xhigh"
      },
      {
        "sourceID": "3b84fee3-b70a-41bc-819e-5fbdef9a0042",
        "slug": "gpt-6-1-sol-high",
        "testedName": "GPT-6.1 Sol (High)",
        "releaseDate": "2026-09-29",
        "url": "https://artificialanalysis.ai/models/gpt-6-1-sol-high"
      },
      {
        "sourceID": "a2e51d62-ea4e-4f15-8be0-be9dc1fb489d",
        "slug": "gpt-6-1-sol-medium",
        "testedName": "GPT-6.1 Sol (Medium)",
        "releaseDate": "2026-09-29",
        "url": "https://artificialanalysis.ai/models/gpt-6-1-sol-medium"
      },
      {
        "sourceID": "b25ac058-1e33-4c31-bbc9-a20c3ad0717a",
        "slug": "gpt-6-1-sol",
        "testedName": "GPT-6.1 Sol (Max)",
        "releaseDate": "2026-09-29",
        "url": "https://artificialanalysis.ai/models/gpt-6-1-sol"
      },
      {
        "sourceID": "e76e0fe5-93ca-4272-9359-2eb1740467d1",
        "slug": "gpt-6-1-sol-low",
        "testedName": "GPT-6.1 Sol (Low)",
        "releaseDate": "2026-09-29",
        "url": "https://artificialanalysis.ai/models/gpt-6-1-sol-low"
      }
    ]
  },
  {
    "canonicalModelID": "openai/o1",
    "canonicalName": "o1",
    "canonicalReleaseDate": "2024-12-05",
    "creatorID": "e67e56e3-15cd-43db-b679-da4660a69f41",
    "creatorName": "OpenAI",
    "creatorSlug": "openai",
    "release": {
      "slug": "o1",
      "name": "o1"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "5ad2f60f-ee05-49fd-85a0-cef69aa7cb7b",
        "slug": "o1",
        "testedName": "o1",
        "releaseDate": "2024-12-05",
        "url": "https://artificialanalysis.ai/models/o1"
      }
    ]
  },
  {
    "canonicalModelID": "openai/o1-pro",
    "canonicalName": "o1-pro",
    "canonicalReleaseDate": "2025-03-19",
    "creatorID": "e67e56e3-15cd-43db-b679-da4660a69f41",
    "creatorName": "OpenAI",
    "creatorSlug": "openai",
    "release": {
      "slug": "o1-pro",
      "name": "o1-pro"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "e8d4100e-165b-4c5d-ac11-ac553590a334",
        "slug": "o1-pro",
        "testedName": "o1-pro",
        "releaseDate": "2025-03-19",
        "url": "https://artificialanalysis.ai/models/o1-pro"
      }
    ]
  },
  {
    "canonicalModelID": "openai/o3",
    "canonicalName": "o3",
    "canonicalReleaseDate": "2025-04-16",
    "creatorID": "e67e56e3-15cd-43db-b679-da4660a69f41",
    "creatorName": "OpenAI",
    "creatorSlug": "openai",
    "release": {
      "slug": "o3",
      "name": "o3"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "16c5b637-8bce-4252-81f2-1b87a36a4e4c",
        "slug": "o3",
        "testedName": "o3",
        "releaseDate": "2025-04-16",
        "url": "https://artificialanalysis.ai/models/o3"
      }
    ]
  },
  {
    "canonicalModelID": "openai/o3-pro",
    "canonicalName": "o3-pro",
    "canonicalReleaseDate": "2025-06-10",
    "creatorID": "e67e56e3-15cd-43db-b679-da4660a69f41",
    "creatorName": "OpenAI",
    "creatorSlug": "openai",
    "release": {
      "slug": "o3-pro",
      "name": "o3-pro"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "ca04852c-eaae-4881-a208-f9b2ca3b7cd6",
        "slug": "o3-pro",
        "testedName": "o3-pro",
        "releaseDate": "2025-06-10",
        "url": "https://artificialanalysis.ai/models/o3-pro"
      }
    ]
  },
  {
    "canonicalModelID": "openai/o4-mini",
    "canonicalName": "o4-mini",
    "canonicalReleaseDate": "2025-04-16",
    "creatorID": "e67e56e3-15cd-43db-b679-da4660a69f41",
    "creatorName": "OpenAI",
    "creatorSlug": "openai",
    "release": {
      "slug": "o4-mini",
      "name": "o4-mini"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "84b49308-6b93-47aa-a4f6-776ee1a1e8cd",
        "slug": "o4-mini",
        "testedName": "o4-mini (High)",
        "releaseDate": "2025-04-16",
        "url": "https://artificialanalysis.ai/models/o4-mini"
      }
    ]
  },
  {
    "canonicalModelID": "stepfun/step-3.5-flash-2603",
    "canonicalName": "Step 3.5 Flash 2603",
    "canonicalReleaseDate": "2026-04-02",
    "creatorID": "ce2e2e8b-7a22-4020-98ec-8ef71000dd42",
    "creatorName": "StepFun",
    "creatorSlug": "stepfun",
    "release": {
      "slug": "step-3-5-flash",
      "name": "Step 3.5 Flash 2603"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "1aa3694e-b656-4dbe-8f84-0c65d8897abb",
        "slug": "step-3-5-flash",
        "testedName": "Step 3.5 Flash 2603",
        "releaseDate": "2026-04-02",
        "url": "https://artificialanalysis.ai/models/step-3-5-flash"
      }
    ]
  },
  {
    "canonicalModelID": "stepfun/step-3.7-flash",
    "canonicalName": "Step 3.7 Flash",
    "canonicalReleaseDate": "2026-05-29",
    "creatorID": "ce2e2e8b-7a22-4020-98ec-8ef71000dd42",
    "creatorName": "StepFun",
    "creatorSlug": "stepfun",
    "release": {
      "slug": "step-3-7-flash",
      "name": "Step 3.7 Flash"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "6c7b322e-2f35-48ff-9171-fb621a726fc0",
        "slug": "step-3-7-flash",
        "testedName": "Step 3.7 Flash",
        "releaseDate": "2026-05-29",
        "url": "https://artificialanalysis.ai/models/step-3-7-flash"
      }
    ]
  },
  {
    "canonicalModelID": "tencent/hy3",
    "canonicalName": "Hy3",
    "canonicalReleaseDate": "2026-07-06",
    "creatorID": "a4e5bd55-a6cd-4dcf-8d4a-1d9643cd3826",
    "creatorName": "Tencent",
    "creatorSlug": "tencent",
    "release": {
      "slug": "hy3",
      "name": "Hy3"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "b23e6c69-96e5-44c9-8f58-4b42e0c399d5",
        "slug": "hy3",
        "testedName": "Hy3",
        "releaseDate": "2026-07-06",
        "url": "https://artificialanalysis.ai/models/hy3"
      }
    ]
  },
  {
    "canonicalModelID": "upstage/solar-pro4",
    "canonicalName": "Solar Pro 4",
    "canonicalReleaseDate": "2026-08-06",
    "creatorID": "64ff7f06-c6fb-42ea-ba24-9cd103ab2d61",
    "creatorName": "Upstage",
    "creatorSlug": "upstage",
    "release": {
      "slug": "solar-pro4",
      "name": "Solar Pro 4"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "1b64aa81-c223-4b8f-909b-82185a234765",
        "slug": "solar-pro4",
        "testedName": "Solar Pro 4",
        "releaseDate": "2026-08-06",
        "url": "https://artificialanalysis.ai/models/solar-pro4"
      }
    ]
  },
  {
    "canonicalModelID": "xai/grok-4.1-fast",
    "canonicalName": "Grok 4.1 Fast",
    "canonicalReleaseDate": "2025-11-19",
    "creatorID": "a1e3ddcf-d3e4-44a5-9e8f-029a69850875",
    "creatorName": "SpaceXAI",
    "creatorSlug": "xai",
    "release": {
      "slug": "grok-4-1-fast",
      "name": "Grok 4.1 Fast"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "23149f9b-c904-43e2-9ec4-afa2bf843941",
        "slug": "grok-4-1-fast-reasoning",
        "testedName": "Grok 4.1 Fast (Reasoning)",
        "releaseDate": "2025-11-19",
        "url": "https://artificialanalysis.ai/models/grok-4-1-fast-reasoning"
      },
      {
        "sourceID": "49fd01f9-887d-4479-b8ce-771a81ecef4e",
        "slug": "grok-4-1-fast",
        "testedName": "Grok 4.1 Fast (Non-reasoning)",
        "releaseDate": "2025-11-19",
        "url": "https://artificialanalysis.ai/models/grok-4-1-fast"
      }
    ]
  },
  {
    "canonicalModelID": "xai/grok-4.5",
    "canonicalName": "Grok 4.5",
    "canonicalReleaseDate": "2026-07-08",
    "creatorID": "a1e3ddcf-d3e4-44a5-9e8f-029a69850875",
    "creatorName": "SpaceXAI",
    "creatorSlug": "xai",
    "release": {
      "slug": "grok-4-5",
      "name": "Grok 4.5"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "794f69b5-cede-482b-b1cc-d769478497cd",
        "slug": "grok-4-5",
        "testedName": "Grok 4.5 (High)",
        "releaseDate": "2026-07-08",
        "url": "https://artificialanalysis.ai/models/grok-4-5"
      }
    ]
  },
  {
    "canonicalModelID": "xai/grok-4.6",
    "canonicalName": "Grok 4.6",
    "canonicalReleaseDate": "2026-08-12",
    "creatorID": "a1e3ddcf-d3e4-44a5-9e8f-029a69850875",
    "creatorName": "SpaceXAI",
    "creatorSlug": "xai",
    "release": {
      "slug": "grok-4-6",
      "name": "Grok 4.6"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "26614164-6840-4e17-a65a-2deb2fe7e87b",
        "slug": "grok-4-6-medium",
        "testedName": "Grok 4.6 (Medium)",
        "releaseDate": "2026-08-12",
        "url": "https://artificialanalysis.ai/models/grok-4-6-medium"
      },
      {
        "sourceID": "c07e65e6-32fc-451e-938d-7477a1c3ffcc",
        "slug": "grok-4-6-low",
        "testedName": "Grok 4.6 (Low)",
        "releaseDate": "2026-08-12",
        "url": "https://artificialanalysis.ai/models/grok-4-6-low"
      },
      {
        "sourceID": "c8adc5cf-fd5a-407b-af51-dc3bede3e49c",
        "slug": "grok-4-6",
        "testedName": "Grok 4.6 (High)",
        "releaseDate": "2026-08-12",
        "url": "https://artificialanalysis.ai/models/grok-4-6"
      },
      {
        "sourceID": "d6f43d0a-e8c4-447c-9ff7-5cf0a9d59aa3",
        "slug": "grok-4-6-xhigh",
        "testedName": "Grok 4.6 (Xhigh)",
        "releaseDate": "2026-08-12",
        "url": "https://artificialanalysis.ai/models/grok-4-6-xhigh"
      }
    ]
  },
  {
    "canonicalModelID": "xai/grok-4.7",
    "canonicalName": "Grok 4.7",
    "canonicalReleaseDate": "2026-09-21",
    "creatorID": "a1e3ddcf-d3e4-44a5-9e8f-029a69850875",
    "creatorName": "SpaceXAI",
    "creatorSlug": "xai",
    "release": {
      "slug": "grok-4-7",
      "name": "Grok 4.7"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "208c16f0-8c5b-4524-ac8a-ac74c02e80a9",
        "slug": "grok-4-7-low",
        "testedName": "Grok 4.7 (Low)",
        "releaseDate": "2026-09-21",
        "url": "https://artificialanalysis.ai/models/grok-4-7-low"
      },
      {
        "sourceID": "272f5f03-aea9-4675-a244-2b753b618cdf",
        "slug": "grok-4-7-high",
        "testedName": "Grok 4.7 (High)",
        "releaseDate": "2026-09-21",
        "url": "https://artificialanalysis.ai/models/grok-4-7-high"
      },
      {
        "sourceID": "59627802-1546-422c-9a65-65b61c022d36",
        "slug": "grok-4-7",
        "testedName": "Grok 4.7 (Xhigh)",
        "releaseDate": "2026-09-21",
        "url": "https://artificialanalysis.ai/models/grok-4-7"
      }
    ]
  },
  {
    "canonicalModelID": "xiaomi/mimo-v2-flash",
    "canonicalName": "MiMo-V2-Flash",
    "canonicalReleaseDate": "2025-12-16",
    "creatorID": "5147c8b4-61d5-4070-9324-8adf8aa144c2",
    "creatorName": "Xiaomi",
    "creatorSlug": "xiaomi",
    "release": {
      "slug": "mimo-v2-flash",
      "name": "MiMo-V2-Flash"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "82b36b4d-84dd-4bc0-ad32-e3aee9442789",
        "slug": "mimo-v2-flash",
        "testedName": "MiMo-V2-Flash (Non-reasoning)",
        "releaseDate": "2025-12-16",
        "url": "https://artificialanalysis.ai/models/mimo-v2-flash"
      },
      {
        "sourceID": "be185709-ddb4-4268-9597-856464359b25",
        "slug": "mimo-v2-flash-reasoning",
        "testedName": "MiMo-V2-Flash (Reasoning)",
        "releaseDate": "2025-12-16",
        "url": "https://artificialanalysis.ai/models/mimo-v2-flash-reasoning"
      }
    ]
  },
  {
    "canonicalModelID": "xiaomi/mimo-v2-pro",
    "canonicalName": "MiMo-V2-Pro",
    "canonicalReleaseDate": "2026-03-18",
    "creatorID": "5147c8b4-61d5-4070-9324-8adf8aa144c2",
    "creatorName": "Xiaomi",
    "creatorSlug": "xiaomi",
    "release": {
      "slug": "mimo-v2-pro",
      "name": "MiMo-V2-Pro"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "5d8183dc-24f4-46c5-a1d0-d937de149364",
        "slug": "mimo-v2-pro",
        "testedName": "MiMo-V2-Pro",
        "releaseDate": "2026-03-18",
        "url": "https://artificialanalysis.ai/models/mimo-v2-pro"
      }
    ]
  },
  {
    "canonicalModelID": "xiaomi/mimo-v2.5",
    "canonicalName": "MiMo-V2.5",
    "canonicalReleaseDate": "2026-04-22",
    "creatorID": "5147c8b4-61d5-4070-9324-8adf8aa144c2",
    "creatorName": "Xiaomi",
    "creatorSlug": "xiaomi",
    "release": {
      "slug": "mimo-v2-5-0424",
      "name": "MiMo-V2.5"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "22d09131-343b-4adf-8760-533e20a2155f",
        "slug": "mimo-v2-5-0424",
        "testedName": "MiMo-V2.5",
        "releaseDate": "2026-04-22",
        "url": "https://artificialanalysis.ai/models/mimo-v2-5-0424"
      }
    ]
  },
  {
    "canonicalModelID": "xiaomi/mimo-v2.5-pro",
    "canonicalName": "MiMo-V2.5-Pro",
    "canonicalReleaseDate": "2026-04-22",
    "creatorID": "5147c8b4-61d5-4070-9324-8adf8aa144c2",
    "creatorName": "Xiaomi",
    "creatorSlug": "xiaomi",
    "release": {
      "slug": "mimo-v2-5-pro",
      "name": "MiMo-V2.5-Pro"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "00f1248e-78e3-4230-8dc8-5e13ba8645e2",
        "slug": "mimo-v2-5-pro",
        "testedName": "MiMo-V2.5-Pro (Reasoning)",
        "releaseDate": "2026-04-22",
        "url": "https://artificialanalysis.ai/models/mimo-v2-5-pro"
      },
      {
        "sourceID": "4764d31d-f4af-4297-8bd1-e993f26bcb64",
        "slug": "mimo-v2-5-pro-non-reasoning",
        "testedName": "MiMo-V2.5-Pro (Non-reasoning)",
        "releaseDate": "2026-04-22",
        "url": "https://artificialanalysis.ai/models/mimo-v2-5-pro-non-reasoning"
      }
    ]
  },
  {
    "canonicalModelID": "xiaomi/mimo-v2.6-flash",
    "canonicalName": "MiMo-V2.6-Flash",
    "canonicalReleaseDate": "2026-09-22",
    "creatorID": "5147c8b4-61d5-4070-9324-8adf8aa144c2",
    "creatorName": "Xiaomi",
    "creatorSlug": "xiaomi",
    "release": {
      "slug": "mimo-v2-6-flash",
      "name": "MiMo-V2.6-Flash"
    },
    "reviewNote": "Source-specific release dates differ; both are retained separately.",
    "configurations": [
      {
        "sourceID": "127de816-57d3-4037-8484-480a613cd413",
        "slug": "mimo-v2-6-flash",
        "testedName": "MiMo-V2.6-Flash",
        "releaseDate": "2026-09-21",
        "url": "https://artificialanalysis.ai/models/mimo-v2-6-flash"
      }
    ]
  },
  {
    "canonicalModelID": "xiaomi/mimo-v2.6-pro",
    "canonicalName": "MiMo-V2.6-Pro",
    "canonicalReleaseDate": "2026-09-22",
    "creatorID": "5147c8b4-61d5-4070-9324-8adf8aa144c2",
    "creatorName": "Xiaomi",
    "creatorSlug": "xiaomi",
    "release": {
      "slug": "mimo-v2-6-pro",
      "name": "MiMo-V2.6-Pro"
    },
    "reviewNote": "Source-specific release dates differ; both are retained separately.",
    "configurations": [
      {
        "sourceID": "24d8fdfe-6241-424e-b7b7-1b6efb06e4fb",
        "slug": "mimo-v2-6-pro",
        "testedName": "MiMo-V2.6-Pro",
        "releaseDate": "2026-09-21",
        "url": "https://artificialanalysis.ai/models/mimo-v2-6-pro"
      }
    ]
  },
  {
    "canonicalModelID": "zhipuai/glm-4.5",
    "canonicalName": "GLM-4.5",
    "canonicalReleaseDate": "2025-07-28",
    "creatorID": "67437eb6-7dc1-4e93-befd-22c8b8ec2065",
    "creatorName": "Z AI",
    "creatorSlug": "zai",
    "release": {
      "slug": "glm-4-5",
      "name": "GLM-4.5"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "1cf439b8-0cfd-47b2-9de2-9a2157e6762b",
        "slug": "glm-4.5",
        "testedName": "GLM-4.5 (Reasoning)",
        "releaseDate": "2025-07-28",
        "url": "https://artificialanalysis.ai/models/glm-4.5"
      }
    ]
  },
  {
    "canonicalModelID": "zhipuai/glm-4.5-air",
    "canonicalName": "GLM-4.5-Air",
    "canonicalReleaseDate": "2025-07-28",
    "creatorID": "67437eb6-7dc1-4e93-befd-22c8b8ec2065",
    "creatorName": "Z AI",
    "creatorSlug": "zai",
    "release": {
      "slug": "glm-4-5-air",
      "name": "GLM-4.5-Air"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "5d303dc9-c027-401f-9803-4e9aa3331007",
        "slug": "glm-4-5-air",
        "testedName": "GLM-4.5-Air",
        "releaseDate": "2025-07-28",
        "url": "https://artificialanalysis.ai/models/glm-4-5-air"
      }
    ]
  },
  {
    "canonicalModelID": "zhipuai/glm-4.5v",
    "canonicalName": "GLM-4.5V",
    "canonicalReleaseDate": "2025-08-11",
    "creatorID": "67437eb6-7dc1-4e93-befd-22c8b8ec2065",
    "creatorName": "Z AI",
    "creatorSlug": "zai",
    "release": {
      "slug": "glm-4-5v",
      "name": "GLM-4.5V"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "0081ab31-d10a-44a0-a10d-eee5533fec65",
        "slug": "glm-4-5v",
        "testedName": "GLM-4.5V (Non-reasoning)",
        "releaseDate": "2025-08-11",
        "url": "https://artificialanalysis.ai/models/glm-4-5v"
      },
      {
        "sourceID": "3068def4-7270-4c06-a320-6f6a5623d564",
        "slug": "glm-4-5v-reasoning",
        "testedName": "GLM-4.5V (Reasoning)",
        "releaseDate": "2025-08-11",
        "url": "https://artificialanalysis.ai/models/glm-4-5v-reasoning"
      }
    ]
  },
  {
    "canonicalModelID": "zhipuai/glm-4.6",
    "canonicalName": "GLM-4.6",
    "canonicalReleaseDate": "2025-09-30",
    "creatorID": "67437eb6-7dc1-4e93-befd-22c8b8ec2065",
    "creatorName": "Z AI",
    "creatorSlug": "zai",
    "release": {
      "slug": "glm-4-6",
      "name": "GLM-4.6"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "6a5d56e1-bb68-4205-8d9b-26b97888bc84",
        "slug": "glm-4-6-reasoning",
        "testedName": "GLM-4.6 (Reasoning)",
        "releaseDate": "2025-09-30",
        "url": "https://artificialanalysis.ai/models/glm-4-6-reasoning"
      },
      {
        "sourceID": "946e7aab-db1c-4c3f-b0b3-7720d0cff187",
        "slug": "glm-4-6",
        "testedName": "GLM-4.6 (Non-reasoning)",
        "releaseDate": "2025-09-30",
        "url": "https://artificialanalysis.ai/models/glm-4-6"
      }
    ]
  },
  {
    "canonicalModelID": "zhipuai/glm-4.6v",
    "canonicalName": "GLM-4.6V",
    "canonicalReleaseDate": "2025-12-08",
    "creatorID": "67437eb6-7dc1-4e93-befd-22c8b8ec2065",
    "creatorName": "Z AI",
    "creatorSlug": "zai",
    "release": {
      "slug": "glm-4-6v",
      "name": "GLM-4.6V"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "43098bd0-77ca-408b-b698-9d60b1d1c3b8",
        "slug": "glm-4-6v",
        "testedName": "GLM-4.6V (Non-reasoning)",
        "releaseDate": "2025-12-08",
        "url": "https://artificialanalysis.ai/models/glm-4-6v"
      },
      {
        "sourceID": "d2d7dd95-770f-4cb0-9bbc-d275ac19c265",
        "slug": "glm-4-6v-reasoning",
        "testedName": "GLM-4.6V (Reasoning)",
        "releaseDate": "2025-12-08",
        "url": "https://artificialanalysis.ai/models/glm-4-6v-reasoning"
      }
    ]
  },
  {
    "canonicalModelID": "zhipuai/glm-4.7",
    "canonicalName": "GLM-4.7",
    "canonicalReleaseDate": "2025-12-22",
    "creatorID": "67437eb6-7dc1-4e93-befd-22c8b8ec2065",
    "creatorName": "Z AI",
    "creatorSlug": "zai",
    "release": {
      "slug": "glm-4-7",
      "name": "GLM-4.7"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "6fc35842-0165-44cf-8570-c484a92b3d8c",
        "slug": "glm-4-7",
        "testedName": "GLM-4.7 (Reasoning)",
        "releaseDate": "2025-12-22",
        "url": "https://artificialanalysis.ai/models/glm-4-7"
      },
      {
        "sourceID": "81b6ddfc-111e-4422-bd44-42ee6165b699",
        "slug": "glm-4-7-non-reasoning",
        "testedName": "GLM-4.7 (Non-reasoning)",
        "releaseDate": "2025-12-22",
        "url": "https://artificialanalysis.ai/models/glm-4-7-non-reasoning"
      }
    ]
  },
  {
    "canonicalModelID": "zhipuai/glm-4.7-flash",
    "canonicalName": "GLM-4.7-Flash",
    "canonicalReleaseDate": "2026-01-19",
    "creatorID": "67437eb6-7dc1-4e93-befd-22c8b8ec2065",
    "creatorName": "Z AI",
    "creatorSlug": "zai",
    "release": {
      "slug": "glm-4-7-flash",
      "name": "GLM-4.7-Flash"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "2c4394a2-b443-470a-908e-5c4a271b780c",
        "slug": "glm-4-7-flash",
        "testedName": "GLM-4.7-Flash (Reasoning)",
        "releaseDate": "2026-01-19",
        "url": "https://artificialanalysis.ai/models/glm-4-7-flash"
      },
      {
        "sourceID": "c8673741-5e1a-46a1-9e4f-710a5c920982",
        "slug": "glm-4-7-flash-non-reasoning",
        "testedName": "GLM-4.7-Flash (Non-reasoning)",
        "releaseDate": "2026-01-19",
        "url": "https://artificialanalysis.ai/models/glm-4-7-flash-non-reasoning"
      }
    ]
  },
  {
    "canonicalModelID": "zhipuai/glm-5.1",
    "canonicalName": "GLM-5.1",
    "canonicalReleaseDate": "2026-04-07",
    "creatorID": "67437eb6-7dc1-4e93-befd-22c8b8ec2065",
    "creatorName": "Z AI",
    "creatorSlug": "zai",
    "release": {
      "slug": "glm-5-1",
      "name": "GLM-5.1"
    },
    "reviewNote": "Exact source release name, creator and release date agree.",
    "configurations": [
      {
        "sourceID": "5aa1c578-af76-4b91-8699-cdd43582b3af",
        "slug": "glm-5-1",
        "testedName": "GLM-5.1 (Reasoning)",
        "releaseDate": "2026-04-07",
        "url": "https://artificialanalysis.ai/models/glm-5-1"
      },
      {
        "sourceID": "92f245a7-43b4-4ffd-8bfb-866746bf824d",
        "slug": "glm-5-1-non-reasoning",
        "testedName": "GLM-5.1 (Non-reasoning)",
        "releaseDate": "2026-04-07",
        "url": "https://artificialanalysis.ai/models/glm-5-1-non-reasoning"
      }
    ]
  },
  {
    "canonicalModelID": "zhipuai/glm-5.2",
    "canonicalName": "GLM-5.2",
    "canonicalReleaseDate": "2026-06-13",
    "creatorID": "67437eb6-7dc1-4e93-befd-22c8b8ec2065",
    "creatorName": "Z AI",
    "creatorSlug": "zai",
    "release": {
      "slug": "glm-5-2",
      "name": "GLM-5.2"
    },
    "reviewNote": "Source-specific release dates differ; both are retained separately.",
    "configurations": [
      {
        "sourceID": "e8aa417f-18fe-46b0-ba62-ef99785a9585",
        "slug": "glm-5-2-non-reasoning",
        "testedName": "GLM-5.2 (Non-reasoning)",
        "releaseDate": "2026-06-16",
        "url": "https://artificialanalysis.ai/models/glm-5-2-non-reasoning"
      },
      {
        "sourceID": "f7a4ea75-e548-4069-80d4-9be8bc7c009b",
        "slug": "glm-5-2",
        "testedName": "GLM-5.2 (Max)",
        "releaseDate": "2026-06-16",
        "url": "https://artificialanalysis.ai/models/glm-5-2"
      }
    ]
  },
  {
    "canonicalModelID": "zhipuai/glm-5.3",
    "canonicalName": "GLM-5.3",
    "canonicalReleaseDate": "2026-08-14",
    "creatorID": "67437eb6-7dc1-4e93-befd-22c8b8ec2065",
    "creatorName": "Z AI",
    "creatorSlug": "zai",
    "release": {
      "slug": "glm-5-3",
      "name": "GLM-5.3"
    },
    "reviewNote": "Source-specific release dates differ; both are retained separately.",
    "configurations": [
      {
        "sourceID": "cc1e488b-8ba4-464d-875d-690166b15ad3",
        "slug": "glm-5-3-low",
        "testedName": "GLM-5.3 (Low)",
        "releaseDate": "2026-08-18",
        "url": "https://artificialanalysis.ai/models/glm-5-3-low"
      },
      {
        "sourceID": "cd684ea4-b475-4269-b001-d469d06d8a7a",
        "slug": "glm-5-3",
        "testedName": "GLM-5.3 (Max)",
        "releaseDate": "2026-08-18",
        "url": "https://artificialanalysis.ai/models/glm-5-3"
      }
    ]
  },
  {
    "canonicalModelID": "zhipuai/glm-5.3-flash",
    "canonicalName": "GLM-5.3-Flash",
    "canonicalReleaseDate": "2026-08-26",
    "creatorID": "67437eb6-7dc1-4e93-befd-22c8b8ec2065",
    "creatorName": "Z AI",
    "creatorSlug": "zai",
    "release": {
      "slug": "glm-5-3-flash",
      "name": "GLM 5.3 Flash"
    },
    "reviewNote": "Reviewed display-name difference; creator and release date agree.",
    "configurations": [
      {
        "sourceID": "19496b81-9f41-4214-a77a-1df803b3c5ae",
        "slug": "glm-5-3-flash",
        "testedName": "GLM 5.3 Flash",
        "releaseDate": "2026-08-26",
        "url": "https://artificialanalysis.ai/models/glm-5-3-flash"
      }
    ]
  }
]
);
