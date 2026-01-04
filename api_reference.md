Listen & Fix API Reference

Introduction

The Listen & Fix system is a comprehensive, AI-driven platform designed to diagnose complex issues and generate detailed repair guides from multimodal user inputs. Strategically, it empowers developers to build applications that offer on-demand diagnostic and repair assistance by interpreting audio, video, images, and text descriptions. This document serves as a complete technical reference for the Listen & Fix API, providing detailed specifications for all available services, endpoints, and data schemas. It is structured to guide developers from high-level concepts through the core services and their underlying data object definitions, ensuring a smooth and successful integration.

Common Workflow

For the vast majority of use cases, integrating the full power of the Listen & Fix platform requires only a single API call to the primary service endpoint. This orchestrates the entire analysis pipeline from diagnosis to guide generation.

POST /api/listen-fix

A minimal request to this endpoint might look like this:

curl -X POST https://api.listen-fix.com/api/listen-fix \
-H "Authorization: Bearer YOUR_API_KEY" \
-H "Content-Type: application/json" \
-d '{
  "description": "My dishwasher is making a loud grinding noise during the wash cycle.",
  "equipment": {
    "type": "appliance",
    "category": "Dishwasher",
    "make": "Bosch",
    "model": "SHP878ZD5N"
  }
}'


The granular Supporting Services detailed later in this document are provided for advanced or specialized applications, such as building a custom multi-step diagnostic UI or performing manual document ingestion for a custom knowledge base.


--------------------------------------------------------------------------------


1. Core Concepts

A successful integration with the Listen & Fix API requires a foundational understanding of its core architectural concepts. The platform's services work together in a sequential pipeline, transforming raw, multimodal user input about a problem into a structured, actionable, and contextually-aware repair guide.

1.1. The Diagnostic & Repair Pipeline

The end-to-end data flow is an orchestrated pipeline that ensures a thorough and accurate analysis. The process runs as follows:

1. Media & Description Processing: The system accepts and processes all user-provided inputs, including media files (audio, video, images) and textual descriptions of the problem.
2. Background Document Crawl: Concurrently with the diagnosis, the system initiates a broad, background web crawl for technical manuals and documentation based on the provided equipment information. This process begins populating a temporary knowledge base.
3. Multimodal Diagnosis: An AI model performs a technical diagnosis by analyzing the user's media and text. This step identifies the primary issue, symptoms, and potential root causes.
4. Contextual Augmentation & Retrieval:
  * Targeted Crawl (Conditional): If the initial background crawl yields insufficient information (fewer than 5 relevant text chunks), the system uses keywords from the diagnosis to perform a second, more targeted web crawl for highly relevant documents.
  * Google Search Fallback (Conditional): If the combined crawl results still provide minimal technical context (less than 500 characters), the system performs a final fallback search using Google Search grounding to supplement the knowledge base with information from the broader web.
  * RAG Query: The system queries the complete, ingested knowledge base to extract specific, factual context related to the diagnosed problem, such as repair procedures, torque specifications, and part numbers.
5. Repair Guide Generation: Using the diagnosis, the retrieved technical context, and the user's preferences (e.g., skill level), the system generates a complete, step-by-step repair guide.
6. Parts Availability Search: The system searches for the required parts identified in the guide, looking for availability and pricing from online and local suppliers based on the user's location.

1.2. Multimodal Diagnosis

The platform's core diagnostic capability is powered by a multimodal model that can natively understand audio, video, and images in conjunction with textual descriptions. This allows the system to identify issues that would be impossible to diagnose from text alone, such as listening for a specific engine noise or observing a visual component failure. This holistic analysis results in a more accurate and reliable diagnosis.

1.3. Retrieval-Augmented Generation (RAG)

To ensure the generated guides are factually grounded and technically accurate, the system employs a just-in-time document crawling and Retrieval-Augmented Generation (RAG) process. When a request is initiated, the system searches the web for relevant technical documents, ingests their content, and segments the information into chunks within a temporary vector store. This store is then queried to find the most relevant information to serve as hyper-relevant, factual context for generating the final repair guide.

1.4. Structured Output

To ensure developers receive predictable, consistent, and easily parsable data, the API endpoints for diagnosis and guide generation enforce a strict JSON schema for their responses. This structured approach simplifies integration by guaranteeing that the data returned by the API will always conform to a well-defined format, eliminating ambiguity and making it easy to map the response to application UIs and data models. This structured approach simplifies integration, and the first step to any integration is authenticating your requests.


--------------------------------------------------------------------------------


2. Authentication

All requests to the Listen & Fix API must be authenticated. Authentication is handled via an API key. Your key must be included in the request header, typically using the Authorization header with the Bearer scheme.

Example Header: Authorization: Bearer YOUR_API_KEY

Note: Please consult your developer portal for specific instructions on key management and retrieval.


--------------------------------------------------------------------------------


3. Listen & Fix Service

The Listen & Fix service is the primary, all-in-one endpoint for developers. A single API call to this service orchestrates the entire diagnostic and repair pipeline described in the Core Concepts, from media analysis to parts sourcing. This endpoint provides the simplest and most direct method for integrating the full functionality of the platform into an application.

3.1. Generate Repair Guide

POST /api/listen-fix

This endpoint accepts a comprehensive set of inputs describing an issue—including media, equipment details, and user preferences—and returns a complete, structured repair guide. As this is a synchronous operation that performs a complex analysis, the maximum request duration is 120 seconds.

3.1.1. Request Body

The request body must be a JSON object conforming to the following structure. At least one media item in the media array or a description string is required.

Field	Type	Required	Description
media	Array<>	No	An array of captured media files. Must be provided if description is absent.
description	string	No	A textual description of the problem. Must be provided if media is empty.
equipment		Yes	An object containing detailed information about the equipment being diagnosed.
preferences		No	An object defining the user's skill level, tool availability, and other preferences.
location		No	The user's location, used to find local parts suppliers.

3.1.2. Response Body (Success)

A successful 200 OK response returns a JSON object containing the generated guide and processing metadata.

* success (boolean): A flag that is true on success.
* guide (object): The primary payload. This is a complete  object containing the diagnosis, step-by-step instructions, parts lists, and more. Top-level keys include title, summary, diagnosis, steps, requiredParts, and safetyWarnings.
* meta (object): Contains metadata about the RAG process.

Field	Type	Description
documentsIngested	number	The number of technical documents successfully crawled and ingested.
chunksCreated	number	The total number of text chunks created from the ingested documents for the vector store.
processingTime	number	The total time in milliseconds taken to process the document ingestion.

3.1.3. Response Body (Error)

If the analysis fails, the API returns a 500 Internal Server Error status code with a JSON body.

* success (boolean): A flag that is false on error.
* error (string): A descriptive message explaining the reason for the failure.

3.1.4. Example Request & Response

* Request: A sample request to diagnose a clicking noise in a vehicle.

{
  "media": [
    {
      "type": "audio",
      "data": "BASE64_ENCODED_AUDIO_DATA",
      "mimeType": "audio/webm"
    }
  ],
  "description": "My car makes a loud clicking noise when I try to start it. The dashboard lights come on, but the engine won't turn over.",
  "equipment": {
    "type": "vehicle",
    "category": "Car",
    "make": "Honda",
    "model": "Accord",
    "year": "2019"
  },
  "preferences": {
    "skillLevel": "beginner",
    "hasBasicTools": true,
    "preferOEM": false,
    "budgetRange": "moderate"
  },
  "location": {
    "zipCode": "90210"
  }
}


* Response: A truncated example of a successful response.

{
  "success": true,
  "guide": {
    "title": "DIY Guide: How to Diagnose and Replace a Faulty Starter Solenoid on a 2019 Honda Accord",
    "summary": "This guide will walk you through the steps to confirm a bad starter solenoid, which is the likely cause of the clicking noise, and how to replace it.",
    "diagnosis": {
      "primaryDiagnosis": "Failed Starter Motor Solenoid",
      "severity": "medium",
      "symptoms": [
        "Loud clicking sound when turning key",
        "Engine does not crank",
        "Dashboard lights are functional"
      ],
      "possibleCauses": [
        "Weak or dead battery",
        "Faulty starter solenoid",
        "Corroded battery terminals",
        "Failed starter motor"
      ]
    },
    "totalTime": "1-2 hours",
    "overallDifficulty": "moderate",
    "confidenceScore": 0.9,
    "safetyWarnings": [
      "Disconnect the negative battery terminal before beginning any work.",
      "Wear safety glasses and gloves."
    ],
    "requiredTools": [
      "Socket wrench set (10mm, 12mm, 14mm sockets)",
      "Wrench set",
      "Safety glasses",
      "Jack and jack stands"
    ],
    "requiredParts": [
      {
        "name": "Starter Motor Assembly",
        "partNumber": "31200-6B2-A02",
        "description": "Includes the starter motor and solenoid. It is often replaced as a single unit.",
        "estimatedPrice": { "low": 150, "high": 250, "currency": "USD" },
        "whereToFind": [
          {
            "storeName": "AutoZone",
            "storeType": "local",
            "website": "https://www.autozone.com"
          }
        ],
        "priority": "required"
      }
    ],
    "steps": [
      {
        "stepNumber": 1,
        "title": "Safety First: Disconnect the Battery",
        "description": "Before starting, use a 10mm wrench to loosen the nut on the negative battery terminal and disconnect the cable.",
        "duration": "5 minutes",
        "difficulty": "easy",
        "tools": ["10mm wrench"],
        "parts": [],
        "warnings": [],
        "tips": ["Tuck the negative cable away to prevent accidental contact."]
      }
    ]
  },
  "meta": {
    "documentsIngested": 5,
    "chunksCreated": 124,
    "processingTime": 12543
  }
}


This primary service is composed of several underlying services, which are also exposed via the API for developers who require more granular control over the diagnostic and retrieval processes.


--------------------------------------------------------------------------------


4. Supporting Services

The core functionalities of the Listen & Fix service are also exposed through a set of granular, special-purpose services. These can be used independently for targeted tasks such as performing a diagnosis without generating a full repair guide or managing the document retrieval process manually.

4.1. Diagnosis Service

The DiagnosisService is responsible for performing a technical diagnosis based on multimodal inputs. It returns a structured diagnosis object but does not generate a full repair guide.

Endpoint: diagnose

* Input: The service accepts a  object containing media, text descriptions, and contextual information about the equipment.
* Output: The service returns a  object, which contains the detailed  object as its primary payload.

4.2. Document Crawler Service

The DocumentCrawlerService manages the just-in-time ingestion and retrieval of technical documents used for Retrieval-Augmented Generation (RAG).

Endpoint: ingestForEquipment

* Input: This endpoint accepts an  object specifying the equipment's make, model, year, and observed symptoms.
* Output: It returns an  object, which contains metadata about the crawl process and a unique storeId. This ID is used to reference the ingested documents in subsequent queries.

Endpoint: getContextForDiagnosis

* Input: This endpoint requires a storeId (string) from a previous ingestion operation and a diagnosis (string) to use as the search query.
* Output: It returns a single formatted string containing the retrieved technical context from the relevant documents, including source information.

4.3. Utility Endpoints

These endpoints provide direct, low-level access to the underlying AI model and file handling capabilities, offering maximum flexibility for custom implementations.

Endpoint: POST /api/gemini

* Description: A general-purpose endpoint for interacting directly with the underlying Gemini model.
* Request Body: Accepts a  object, allowing for flexible combinations of text, media, system instructions, and other configuration options.
* Response Body: Returns the standard Gemini API response structure, which includes the generated text, a list of candidates, and usageMetadata.

Endpoint: POST /api/gemini/upload

* Description: This endpoint is used for uploading files, especially large ones (>20MB), to the Gemini Files API. This is the recommended method for handling large video or audio files before analysis.
* Request Body: The request body must be multipart/form-data, containing a file and an optional mimeType field.
* Response Body: Returns a JSON object with the fileUri, fileName (the full resource name, e.g., files/12345), and other metadata associated with the successfully uploaded file.

Endpoint: DELETE /api/gemini/upload

* Description: This endpoint deletes a previously uploaded file from the Gemini Files API, allowing for cleanup of temporary media files.
* Request Body: Accepts a JSON object with a single fileName key, which is the full resource name (e.g., files/12345) returned by the upload endpoint.
* Response Body: Returns { "success": true } on a successful deletion.

All data structures passed to and from these endpoints are defined in the following section.


--------------------------------------------------------------------------------


5. Object Schemas

This section provides a centralized, detailed definition for every data object used across the Listen & Fix API services.

5.1. RepairGuide

The primary object containing the complete, generated repair guide.

Field	Type	Description
title	string	The main title of the repair guide.
summary	string	A brief summary of the issue and the repair.
diagnosis		The detailed diagnosis object.
totalTime	string	An estimated total time to complete the repair (e.g., "1-2 hours").
overallDifficulty	string	The overall difficulty of the repair. See the  enumeration.
safetyWarnings	Array<string>	A list of critical safety warnings to observe before and during the repair.
prerequisites	Array<string>	A list of preparatory steps or conditions required before starting the repair.
requiredTools	Array<string>	A list of tools that are required to perform the repair.
optionalTools	Array<string>	A list of tools that are helpful but not strictly necessary.
requiredParts	Array<>	A list of parts needed for the repair.
steps	Array<>	The ordered, step-by-step instructions for the repair.
troubleshooting	Array<{ problem: string; solution: string; }>	A list of common problems that might occur during the repair and their solutions.
references	Array<object>	An array of objects detailing the sources used for RAG, such as the number of technical documents ingested.
generatedAt	string	The ISO 8601 timestamp of when the guide was generated.
confidenceScore	number	The AI's confidence in the diagnosis, from 0.0 to 1.0.
disclaimers	Array<string>	A list of legal and safety disclaimers.

5.2. DiagnosisSchema

Contains the detailed results of the diagnostic analysis.

Field	Type	Description
confidence	number	The confidence level of the diagnosis, from 0.0 to 1.0.
primaryDiagnosis	string	A concise description of the main issue identified.
symptoms	Array<string>	A list of observed symptoms that support the diagnosis.
possibleCauses	Array<string>	A list of potential root causes for the diagnosed issue.
severity	string	The assessed severity of the issue. See the  enumeration.
recommendedActions	Array<>	A prioritized list of actions to take.
additionalNotes	string	(Optional) Any additional notes or observations from the analysis.
requiresExpertReview	boolean	A flag indicating whether consultation with a human expert is recommended.

5.3. RequiredPart

Describes a single part required for the repair.

Field	Type	Description
name	string	The common name of the part.
partNumber	string	(Optional) The manufacturer or aftermarket part number.
oemPartNumber	string	(Optional) The Original Equipment Manufacturer part number.
description	string	A brief description of the part and its function.
estimatedPrice	object	An object with low (number), high (number), and currency (string) fields.
alternatives	Array<object>	(Optional) A list of alternative parts with name, partNumber, price, and quality ('economy', 'standard', 'premium').
whereToFind	Array<>	A list of potential suppliers for the part.
priority	string	The necessity of the part. See the  enumeration.

5.4. RepairStep

Defines a single step in the repair process.

Field	Type	Description
stepNumber	integer	The sequential number of the step.
title	string	A short, descriptive title for the step.
description	string	A detailed explanation of the actions to perform in this step.
duration	string	An estimated time to complete this step (e.g., "10-15 minutes").
difficulty	string	The difficulty of this specific step. See the  enumeration.
tools	Array<string>	A list of tools needed for this step.
parts	Array<string>	A list of parts used or installed in this step.
warnings	Array<string>	A list of safety warnings specific to this step.
tips	Array<string>	Helpful tips or common pitfalls to avoid for this step.
imageUrl	string	(Optional) A URL to an image illustrating the step.
videoTimestamp	string	(Optional) A timestamp referencing a relevant moment in the user's provided video.

5.5. PartSource

Describes a supplier where a required part can be purchased.

Field	Type	Description
storeName	string	The name of the supplier (e.g., "AutoZone", "RockAuto").
storeType	string	The type of supplier. See the  enumeration.
distance	string	(Optional) The distance to a local store (e.g., "5.2 miles").
address	string	(Optional) The physical address of the store.
phone	string	(Optional) The phone number of the store.
website	string	(Optional) The URL to the supplier's website.
inStock	boolean	(Optional) A flag indicating if the part is likely in stock.
price	number	(Optional) The price of the part at this specific supplier.
url	string	(Optional) A direct URL to the product page.

5.6. RecommendedAction

A suggested action to take based on the diagnosis.

Field	Type	Description
priority	integer	The priority of the action, with 1 being the highest.
action	string	A description of the recommended action.
estimatedTime	string	(Optional) The estimated time to perform the action.
difficulty	string	The difficulty of the action. See the  enumeration.
safetyWarnings	Array<string>	(Optional) Any safety warnings associated with this action.

5.7. EquipmentInfo

Detailed information about the equipment being diagnosed.

Field	Type	Description
type	string	The general type of equipment. See the  enumeration.
category	string	(Optional) A more specific category (e.g., "Refrigerator", "SUV").
make	string	(Optional) The manufacturer or brand of the equipment (e.g., "Honda", "Samsung").
model	string	(Optional) The specific model name or number.
year	string	(Optional) The manufacturing year of the equipment.
additionalInfo	string	(Optional) Any other relevant information, such as operating conditions.

5.8. MediaCapture

Represents a single piece of media provided by the user.

Field	Type	Description
type	string	The type of media. See the  enumeration.
data	string	The Base64-encoded media content.
mimeType	string	The MIME type of the media (e.g., "audio/webm", "image/jpeg").
thumbnail	string	(Optional) A Base64-encoded thumbnail for video or image files.

5.9. UserPreferences

Defines the user's profile to tailor the repair guide.

Field	Type	Description
skillLevel	string	The user's self-assessed DIY skill level. See the  enumeration.
hasBasicTools	boolean	A flag indicating if the user has a basic set of tools (wrenches, screwdrivers, etc.).
budgetRange	string	(Optional) The user's budget for the repair. See the  enumeration.
preferOEM	boolean	A flag indicating if the user prefers Original Equipment Manufacturer (OEM) parts.

5.10. Location

The user's geographical location.

Field	Type	Description
zipCode	string	(Optional) The user's postal or ZIP code.
city	string	(Optional) The user's city.
state	string	(Optional) The user's state or province.

5.11. DiagnosisInput

The input object for the standalone DiagnosisService.

Field	Type	Description
textDescription	string	(Optional) A textual description of the problem.
audioData	object	(Optional) Audio data with base64 (string) and mimeType (string) fields.
videoData	object	(Optional) Video data with base64 or fileUri (string) and mimeType (string) fields.
imageData	Array<object>	(Optional) An array of image objects, each with base64 and mimeType fields.
context	object	(Optional) Contextual information, including equipmentType, equipmentModel, previousIssues, and operatingConditions.

5.12. DiagnosisResult

The output object from the standalone DiagnosisService.

Field	Type	Description
diagnosis		The complete diagnosis object.
rawResponse	string	(Optional) The raw string response from the AI model.
processingTime	number	The time in milliseconds taken to perform the diagnosis.
inputsUsed	Array<string>	A list of the input types that were used in the analysis (e.g., ["text", "audio"]).

5.13. EquipmentQuery

The input object for the DocumentCrawlerService.

Field	Type	Description
type	string	The general type of equipment (e.g., "vehicle").
make	string	(Optional) The manufacturer or brand.
model	string	(Optional) The specific model name or number.
year	string	(Optional) The manufacturing year.
symptom	string	(Optional) The primary symptom observed.
diagnosis	string	(Optional) The diagnosis, used for a more targeted document search.

5.14. IngestionResult

The output object from the DocumentCrawlerService's ingestForEquipment endpoint.

Field	Type	Description
success	boolean	A flag indicating if the ingestion was successful.
documentsFound	number	The total number of potentially relevant document URLs found.
documentsCrawled	number	The number of documents that were successfully crawled and processed.
chunksCreated	number	The total number of text chunks created for the vector store.
storeId	string	(Optional) The unique identifier for the temporary document store, used for subsequent queries.
errors	Array<string>	A list of any errors encountered during the process.
processingTime	number	The total time in milliseconds taken for the operation.

5.15. GeminiRequest

The request body for the generic POST /api/gemini endpoint.

Field	Type	Description
contents	Array<>	An array of content parts to send to the model.
systemInstruction	string	(Optional) A system-level instruction to guide the model's behavior.
responseSchema	object	(Optional) A JSON schema to structure the model's output.
useStructuredOutput	boolean	(Optional) If true and responseSchema is provided, enforces structured JSON output.
thinkingBudget	number	(Optional) A budget for the model's internal thinking process.
useGrounding	boolean	(Optional) If true, enables Google Search grounding to provide web-based context.

5.16. ContentPart

A single piece of content within a GeminiRequest.

Field	Type	Description
type	string	The type of content: 'text', 'image', 'audio', or 'video'.
data	string	(Optional) The Base64-encoded data for media types.
mimeType	string	(Optional) The MIME type for media types.
text	string	(Optional) The text content for type: 'text'.
fileUri	string	(Optional) A URI pointing to a file previously uploaded via POST /api/gemini/upload.


--------------------------------------------------------------------------------


6. Enumerations

This section lists all possible values for fields that have a fixed set of options (enumerated types).

6.1. EquipmentType

Used in the  object.

Value	Description
vehicle	Cars, trucks, motorcycles, and other vehicles.
appliance	Home appliances like refrigerators, washers, etc.
hvac	Heating, ventilation, and air conditioning systems.
plumbing	Toilets, faucets, water heaters, etc.
electrical	Outlets, switches, circuit breakers, etc.
other	Any other category of equipment.

6.2. SkillLevel

Used in the  object.

Value	Description
beginner	User has little to no DIY experience.
intermediate	User has some experience with basic repairs.
advanced	User is very comfortable with complex repairs.
professional	User is a trained professional or expert.

6.3. BudgetRange

Used in the  object.

Value	Description
budget	User prefers the most cost-effective parts and solutions.
moderate	User is willing to spend a reasonable amount for quality and reliability.
any	User has no specific budget constraints.

6.4. Severity

Used in the  object.

Value	Description
low	Minor issue, does not affect primary function or safety.
medium	Affects performance or convenience; should be addressed soon.
high	Significantly impacts function or poses a minor safety risk.
critical	Poses a major safety risk or renders the equipment inoperable.

6.5. Difficulty

Used in the  and  objects.

Value	Description
easy	Requires minimal skill and basic tools.
moderate	Requires some experience and a good set of tools.
difficult	Requires significant skill, specialized tools, or is complex.
expert	Should only be performed by a professional.
expert-only	(For ) Same as expert.

6.6. PartPriority

Used in the  object.

Value	Description
required	The repair cannot be completed without this part.
recommended	The part should be replaced for best results or preventative maintenance.
optional	The part can be replaced for cosmetic or minor functional improvements.

6.7. PartStoreType

Used in the  object.

Value	Description
local	A physical, local retail store.
online	An e-commerce website.
dealer	An official dealership for the equipment brand.

6.8. MediaCaptureType

Used in the  object.

Value	Description
audio	An audio recording.
video	A video recording.
image	A still image.


--------------------------------------------------------------------------------


7. Error Handling

The Listen & Fix API uses standard HTTP status codes to indicate the success or failure of a request. A non-200 status code signals that an error has occurred. The response body for an error will always be a JSON object containing a descriptive error message.

Status Code	Meaning
400 Bad Request	The request was malformed. This could be due to an invalid JSON payload, missing required fields, or a file that is too large.
500 Internal Server Error	An unexpected error occurred on the server during analysis, diagnosis, or guide generation. The error message in the response body will provide more detail.

When an error occurs, the response body will follow this format:

{
  "success": false,
  "error": "A descriptive message about what went wrong."
}
