# Airline Chat - Conversational Ticketing System

A modern airline ticketing system that uses natural language processing and a chatbot interface to help users search for flights, book tickets, and check in for their flights.

## Overview

Airline Chat provides a conversational interface for interacting with an airline's booking system. Instead of navigating complex forms and interfaces, users can simply chat with the AI assistant to complete their tasks.

## Features

- **Natural Language Flight Search**: Search for flights using conversational language
- **AI-Powered Responses**: All user interactions are processed through an AI model (GPT-4o) to generate natural responses
- **Booking Management**: Book flight tickets through simple conversations
- **Check-in Service**: Complete flight check-in through the chat interface
- **Multi-Channel Support**: Access via WebSocket or REST API endpoints
- **Conversation History**: Full conversation history is saved and can be retrieved

## Architecture

The system consists of several components:

- **API Gateway**: Central component that orchestrates communication between the client, AI service, and backend APIs
- **AI Service**: Processes natural language input, detects user intent, and generates responses
- **Adapters**: Interfaces with airline backend systems (flight search, booking, check-in)
- **CosmosDB Service**: Stores conversation history and user sessions

## Technical Stack

- **Backend**: Node.js with Express
- **Real-time Communication**: Socket.io
- **Database**: Azure Cosmos DB
- **AI/NLP**: OpenAI GPT models
- **API Communication**: REST

## Getting Started

### Prerequisites

- Node.js (v14+)
- Azure Cosmos DB account (or local emulator)
- OpenAI API access

### Installation

1. Clone the repository
```bash
git clone https://github.com/yourusername/AirlineChat.git
cd AirlineChat
```

2. Install dependencies
```bash
npm install
```

3. Set up environment variables
Create a `.env` file in the root directory with the following variables:
```
PORT=3001
CLIENT_ORIGIN=http://localhost:3000
COSMOSDB_ENDPOINT=your_cosmosdb_endpoint
COSMOSDB_KEY=your_cosmosdb_key
COSMOSDB_DATABASE=AirlineChat
COSMOSDB_CONTAINER=Conversations
OPENAI_API_KEY=your_openai_api_key
OPENAI_API_MODEL=gpt-4o
AIRLINE_API_ENDPOINT=your_airline_api_endpoint
```

4. Start the server
```bash
npm start
```

## Flow Processing

The system handles three main flows:

1. **Flight Search Flow**: Collects origin, destination, dates, and passenger information to search for available flights
2. **Booking Flow**: Collects flight details and passenger information to book a ticket
3. **Check-in Flow**: Collects booking reference and passenger details to complete check-in

Each flow may consist of multiple steps where the system collects the necessary information before executing the final action.

## Error Handling

The system uses AI-generated responses even for error scenarios, ensuring a consistent and helpful user experience. When backend API calls fail, the system acknowledges that the operation might have succeeded despite the communication error and provides appropriate guidance.

## License

MIT License 
