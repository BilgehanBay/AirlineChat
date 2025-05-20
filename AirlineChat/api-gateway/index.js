// Import required dependencies
require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

// Import service classes
const ApiAdapters = require('./adapters');
const AiService = require('./aiService');
const CosmosDbService = require('./cosmosDbService');

// Initialize express app
const app = express();
const server = http.createServer(app);

// Configure CORS
app.use(cors({
  origin: process.env.CLIENT_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

// Middleware for JSON parsing
app.use(express.json());

// Initialize services
const aiService = new AiService();
const cosmosDbService = new CosmosDbService();

// Initialize Socket.io
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_ORIGIN || '*',
    methods: ['GET', 'POST']
  }
});

// Initialize Cosmos DB connection
(async () => {
  try {
    const dbConnected = await cosmosDbService.initialize();
    console.log(`Cosmos DB connection ${dbConnected ? 'successful' : 'failed'}`);
  } catch (error) {
    console.error('Error initializing Cosmos DB:', error);
  }
})();

// Store active user sessions
const userSessions = {};

// Socket.io connection handler
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  // Handle user identification
  socket.on('identify', async (userId) => {
    console.log(`User identified: ${userId}`);
    socket.userId = userId;
    userSessions[socket.id] = {
      userId,
      activeFlow: null,
      currentStep: null,
      collectedParams: {},
      conversationHistory: []
    };
    
    try {
      // Load conversation history from Cosmos DB
      const history = await cosmosDbService.getConversationHistory(userId);
      if (history.length > 0) {
        userSessions[socket.id].conversationHistory = history;
        socket.emit('history', history);
      }
    } catch (error) {
      console.error('Error loading conversation history:', error);
    }
    
    // Send welcome message
    const welcomeMessage = {
      id: Date.now().toString(),
      content: "Welcome to Airline Chat! How can I help you today?",
      timestamp: new Date().toISOString(),
      sender: 'assistant',
      userId
    };
    
    socket.emit('message', welcomeMessage);
    userSessions[socket.id].conversationHistory.push(welcomeMessage);
    
    // Save welcome message to database
    try {
      await cosmosDbService.saveMessage(welcomeMessage);
    } catch (error) {
      console.error('Error saving welcome message:', error);
    }
  });
  
  // Handle incoming messages
  socket.on('message', async (message) => {
    console.log(`Received message from ${socket.userId}:`, message.content);
    
    const session = userSessions[socket.id];
    if (!session) {
      console.error('No session found for socket:', socket.id);
      return;
    }
    
    // Save user message to Cosmos DB
    try {
      await cosmosDbService.saveMessage(message);
      session.conversationHistory.push(message);
    } catch (error) {
      console.error('Error saving user message:', error);
    }
    
    // Process the message with AI service
    try {
      const intent = await aiService.detectIntent(
        message.content, 
        {
          activeFlow: session.activeFlow,
          currentStep: session.currentStep,
          collectedParams: session.collectedParams
        }
      );
      
      console.log('Detected intent:', intent);
      
      let responseContent = '';
      
      // Handle different actions based on intent
      switch (intent.action) {
        case 'QUERY_FLIGHT':
          try {
            console.log('Processing QUERY_FLIGHT intent with parameters:', JSON.stringify(intent.parameters));
            
            // Call the flight search API
            const flights = await ApiAdapters.searchFlights(intent.parameters);
            console.log('Flight search result count:', flights ? flights.length : 0);
            
            // Pass the result to the AI to generate a natural response
            const aiPrompt = `You are an airline flight search assistant. The user searched for flights with these parameters: ${JSON.stringify(intent.parameters)}. 
The search API returned these results: ${JSON.stringify(flights)}. 
Please generate a natural, conversational response about the search results.
If flights were found, mention how many and summarize them with details like flight numbers, departure/arrival times and prices.
If no flights were found, suggest alternatives politely.
End with an appropriate question about whether they want to book a flight or refine their search.`;
            
            // Generate response using AI
            const aiResponse = await aiService.generateResponse([
              { sender: 'system', content: aiPrompt },
              { sender: 'user', content: message.content }
            ]);
            
            responseContent = aiResponse;
          } catch (error) {
            console.error('Error in QUERY_FLIGHT flow:', error);
            
            // Even for errors, use AI to generate a response
            const aiPrompt = `You are an airline flight search assistant. The user tried to search for flights but there was an error: "${error.message}".
Please generate a natural, conversational response apologizing for the issue and suggesting they try again or modify their search criteria.`;
            
            try {
              const aiResponse = await aiService.generateResponse([
                { sender: 'system', content: aiPrompt },
                { sender: 'user', content: message.content }
              ]);
              responseContent = aiResponse;
            } catch (innerError) {
              console.error('Error generating AI response for flight search error:', innerError);
              responseContent = "I'm sorry, I encountered an error while searching for flights. Please try again.";
            }
          }
          break;
          
        case 'BUY_TICKET':
          try {
            console.log('Processing BUY_TICKET intent with parameters:', JSON.stringify(intent.parameters));
            
            // Call the booking API
            const ticketResult = await ApiAdapters.bookTicket(intent.parameters);
            console.log('Ticket booking result:', JSON.stringify(ticketResult));
            
            // Pass the result to the AI to generate a natural response
            const aiPrompt = `You are an airline booking assistant. The user tried to book a ticket with these details: ${JSON.stringify(intent.parameters)}. 
The booking API returned this result: ${JSON.stringify(ticketResult)}. 
Please generate a natural, conversational response about the booking status. 
If there was an error, explain it politely and suggest what they might do to fix it.
If it was successful, confirm the booking in a friendly way.`;
            
            // Generate response using AI
            const aiResponse = await aiService.generateResponse([
              { sender: 'system', content: aiPrompt },
              { sender: 'user', content: message }
            ]);
            
            responseContent = aiResponse;
          } catch (error) {
            console.error('Error in BUY_TICKET flow:', error);
            responseContent = "I'm sorry, I encountered an error while booking your ticket. Please try again.";
          }
          break;
          
        case 'CHECK_IN':
          try {
            console.log('Processing CHECK_IN intent with parameters:', JSON.stringify(intent.parameters));
            
            // Call the check-in API
            const checkInResult = await ApiAdapters.checkIn(intent.parameters);
            console.log('Check-in result:', JSON.stringify(checkInResult));
            
            // Pass the result to the AI to generate a natural response
            const aiPrompt = `You are an airline check-in assistant. The user tried to check in with these details: ${JSON.stringify(intent.parameters)}. 
The check-in API returned this result: ${JSON.stringify(checkInResult)}. 
Please generate a natural, conversational response about the check-in status. 
If there was an error, explain it politely and suggest what they might do to fix it.
If it was successful, confirm the check-in in a friendly way.`;
            
            // Generate response using AI
            const aiResponse = await aiService.generateResponse([
              { sender: 'system', content: aiPrompt },
              { sender: 'user', content: message }
            ]);
            
            responseContent = aiResponse;
          } catch (error) {
            console.error('Error in CHECK_IN flow:', error);
            responseContent = "I'm sorry, I encountered an error while processing your check-in. Please try again.";
          }
          break;
          
        case 'START_QUERY_FLOW':
          session.activeFlow = 'QUERY_FLIGHT';
          session.currentStep = 1;
          session.collectedParams = intent.parameters || {};
          
          // Use AI to generate a response for starting the flight search flow
          try {
            const aiPrompt = `You are an airline flight search assistant. The user wants to search for flights but hasn't provided all necessary details.
Current parameters: ${JSON.stringify(session.collectedParams)}.
Generate a natural conversational response that acknowledges their request and asks for the missing details needed to search for flights 
(typically origin airport, destination airport, dates, and number of passengers).`;
            
            const aiResponse = await aiService.generateResponse([
              { sender: 'system', content: aiPrompt },
              { sender: 'user', content: message.content }
            ]);
            
            responseContent = aiResponse;
          } catch (error) {
            console.error('Error generating AI response for START_QUERY_FLOW:', error);
            responseContent = intent.response || "Let's search for flights. Could you please tell me your departure and destination airports?";
          }
          break;
          
        case 'START_BUY_FLOW':
          session.activeFlow = 'BUY_TICKET';
          session.currentStep = 1;
          session.collectedParams = intent.parameters || {};
          
          // Use AI to generate a response for starting the booking flow
          try {
            const aiPrompt = `You are an airline booking assistant. The user wants to book a flight but hasn't provided all necessary details.
Current parameters: ${JSON.stringify(session.collectedParams)}.
Generate a natural conversational response that acknowledges their booking request and asks for the missing details
(typically flight number, date, and passenger names).`;
            
            const aiResponse = await aiService.generateResponse([
              { sender: 'system', content: aiPrompt },
              { sender: 'user', content: message.content }
            ]);
            
            responseContent = aiResponse;
          } catch (error) {
            console.error('Error generating AI response for START_BUY_FLOW:', error);
            responseContent = intent.response || "I'll help you book a ticket. Could you please provide the flight number you'd like to book?";
          }
          break;
          
        case 'START_CHECKIN_FLOW':
          session.activeFlow = 'CHECK_IN';
          session.currentStep = 1;
          session.collectedParams = intent.parameters || {};
          
          // Use AI to generate a response for starting the check-in flow
          try {
            const aiPrompt = `You are an airline check-in assistant. The user wants to check in for a flight but hasn't provided all necessary details.
Current parameters: ${JSON.stringify(session.collectedParams)}.
Generate a natural conversational response that acknowledges their check-in request and asks for the missing details
(typically flight number, date, and passenger name).`;
            
            const aiResponse = await aiService.generateResponse([
              { sender: 'system', content: aiPrompt },
              { sender: 'user', content: message.content }
            ]);
            
            responseContent = aiResponse;
          } catch (error) {
            console.error('Error generating AI response for START_CHECKIN_FLOW:', error);
            responseContent = intent.response || "Let's check you in for your flight. Could you please provide your flight number?";
          }
          break;
          
        case 'CONTINUE_FLOW':
          session.activeFlow = intent.flow;
          session.currentStep = intent.nextStep;
          session.collectedParams = intent.collectedParams || {};
          
          if (intent.isFlowComplete) {
            // Handle complete flow based on type
            switch (intent.flow) {
              case 'QUERY_FLIGHT':
                try {
                  console.log('Completing QUERY_FLIGHT flow with parameters:', JSON.stringify(session.collectedParams));
                  
                  // Call the flight search API
                  const flights = await ApiAdapters.searchFlights(session.collectedParams);
                  console.log('Flight search result count:', flights ? flights.length : 0);
                  
                  // Pass the result to the AI to generate a natural response
                  const aiPrompt = `You are an airline flight search assistant. The user has completed providing all details for a flight search with these parameters: ${JSON.stringify(session.collectedParams)}. 
The search API returned these results: ${JSON.stringify(flights)}. 
Please generate a natural, conversational response about the search results.
If flights were found, mention how many and summarize them with details like flight numbers, departure/arrival times and prices.
If no flights were found, suggest alternatives politely.
End with an appropriate question about whether they want to book a flight or refine their search.`;
                  
                  // Generate response using AI
                  const aiResponse = await aiService.generateResponse([
                    { sender: 'system', content: aiPrompt },
                    { sender: 'user', content: message.content }
                  ]);
                  
                  responseContent = aiResponse;
                  
                  // Reset flow
                  session.activeFlow = null;
                  session.currentStep = null;
                } catch (error) {
                  console.error('Error completing QUERY_FLIGHT flow:', error);
                  // Use AI to generate error response
                  try {
                    const aiPrompt = `You are an airline flight search assistant. The user tried to search for flights with parameters: ${JSON.stringify(session.collectedParams)}, but there was an error: "${error.message}".
Please generate a natural, conversational response apologizing for the issue and suggesting they try again or modify their search criteria.`;
                    
                    const aiResponse = await aiService.generateResponse([
                      { sender: 'system', content: aiPrompt },
                      { sender: 'user', content: message.content }
                    ]);
                    responseContent = aiResponse;
                  } catch (innerError) {
                    console.error('Error generating AI response for flight search error:', innerError);
                    responseContent = "I'm sorry, I encountered an error while searching for flights. Please try again.";
                  }
                }
                break;
                
              case 'BUY_TICKET':
                try {
                  console.log('Completing BUY_TICKET flow with parameters:', JSON.stringify(session.collectedParams));
                  
                  // Call the booking API
                  const ticketResult = await ApiAdapters.bookTicket(session.collectedParams);
                  console.log('Ticket booking result:', JSON.stringify(ticketResult));
                  
                  // Pass the result to the AI to generate a natural response
                  const aiPrompt = `You are an airline booking assistant. The user has completed providing all details for booking a ticket with these parameters: ${JSON.stringify(session.collectedParams)}. 
The booking API returned this result: ${JSON.stringify(ticketResult)}. 
Please generate a natural, conversational response about the booking status. 
If there was an error, explain it politely and suggest what they might do to fix it.
If it was successful, confirm the booking in a friendly way.`;
                  
                  // Generate response using AI
                  const aiResponse = await aiService.generateResponse([
                    { sender: 'system', content: aiPrompt },
                    { sender: 'user', content: message.content }
                  ]);
                  
                  responseContent = aiResponse;
                  
                  // Reset flow
                  session.activeFlow = null;
                  session.currentStep = null;
                } catch (error) {
                  console.error('Error completing BUY_TICKET flow:', error);
                  // Use AI to generate error response
                  try {
                    const aiPrompt = `You are an airline booking assistant. The user tried to book a ticket with parameters: ${JSON.stringify(session.collectedParams)}, but there was an error: "${error.message}".
Please generate a natural, conversational response. Note that even though there was an error, the booking might have still succeeded, so suggest they check their bookings or contact customer service.`;
                    
                    const aiResponse = await aiService.generateResponse([
                      { sender: 'system', content: aiPrompt },
                      { sender: 'user', content: message.content }
                    ]);
                    responseContent = aiResponse;
                  } catch (innerError) {
                    console.error('Error generating AI response for booking error:', innerError);
                    responseContent = "I'm sorry, I encountered an error while booking your ticket. Please try again.";
                  }
                }
                break;
                
              case 'CHECK_IN':
                try {
                  console.log('Completing CHECK_IN flow with parameters:', JSON.stringify(session.collectedParams));
                  
                  // Call the check-in API
                  const checkInResult = await ApiAdapters.checkIn(session.collectedParams);
                  console.log('Check-in result:', JSON.stringify(checkInResult));
                  
                  // Pass the result to the AI to generate a natural response
                  const aiPrompt = `You are an airline check-in assistant. The user has completed providing all details for check-in with these parameters: ${JSON.stringify(session.collectedParams)}. 
The check-in API returned this result: ${JSON.stringify(checkInResult)}. 
Please generate a natural, conversational response about the check-in status. 
If there was an error, explain it politely and suggest what they might do to fix it.
If it was successful, confirm the check-in in a friendly way.`;
                  
                  // Generate response using AI
                  const aiResponse = await aiService.generateResponse([
                    { sender: 'system', content: aiPrompt },
                    { sender: 'user', content: message.content }
                  ]);
                  
                  responseContent = aiResponse;
                  
                  // Reset flow
                  session.activeFlow = null;
                  session.currentStep = null;
                } catch (error) {
                  console.error('Error completing CHECK_IN flow:', error);
                  // Use AI to generate error response
                  try {
                    const aiPrompt = `You are an airline check-in assistant. The user tried to check in with parameters: ${JSON.stringify(session.collectedParams)}, but there was an error: "${error.message}".
Please generate a natural, conversational response. Note that even though there was an error, the check-in might have still succeeded, so suggest they check their flight status or contact customer service.`;
                    
                    const aiResponse = await aiService.generateResponse([
                      { sender: 'system', content: aiPrompt },
                      { sender: 'user', content: message.content }
                    ]);
                    responseContent = aiResponse;
                  } catch (innerError) {
                    console.error('Error generating AI response for check-in error:', innerError);
                    responseContent = "I'm sorry, I encountered an error while processing your check-in. Please try again.";
                  }
                }
                break;
            }
          } else {
            // For ongoing flow steps, use AI to generate responses
            try {
              const aiPrompt = `You are an airline assistant helping the user through a ${session.activeFlow} process. 
They are at step ${session.currentStep} of the process and have provided these details so far: ${JSON.stringify(session.collectedParams)}.
The AI model detected their response and decided to continue the flow with this information: ${JSON.stringify(intent)}.
Generate a natural conversational response that acknowledges what they've provided and asks for the next piece of information needed.`;
              
              const aiResponse = await aiService.generateResponse([
                { sender: 'system', content: aiPrompt },
                { sender: 'user', content: message.content }
              ]);
              
              responseContent = aiResponse;
            } catch (error) {
              console.error('Error generating AI response for CONTINUE_FLOW:', error);
              responseContent = intent.response;
            }
          }
          break;
          
        case 'CHAT':
        default:
          responseContent = intent.response || "I'm not sure I understand. Could you please rephrase your request?";
          break;
      }
      
      // Create assistant response
      const assistantMessage = {
        id: Date.now().toString(),
        content: responseContent,
        timestamp: new Date().toISOString(),
        sender: 'assistant',
        userId: socket.userId
      };
      
      // Send response to client
      socket.emit('message', assistantMessage);
      session.conversationHistory.push(assistantMessage);
      
      // Save assistant message to database
      try {
        await cosmosDbService.saveMessage(assistantMessage);
      } catch (error) {
        console.error('Error saving assistant message:', error);
      }
      
    } catch (error) {
      console.error('Error processing message:', error);
      
      // Send error response
      const errorMessage = {
        id: Date.now().toString(),
        content: "I'm sorry, I encountered an error processing your request. Please try again.",
        timestamp: new Date().toISOString(),
        sender: 'assistant',
        userId: socket.userId
      };
      
      socket.emit('message', errorMessage);
    }
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    delete userSessions[socket.id];
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'API Gateway is running' });
});

// REST API endpoint for chat (alternative to WebSocket)
app.post('/api/chat', async (req, res) => {
  try {
    const { message, userId } = req.body;
    
    if (!message || !userId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Create user message
    const userMessage = {
      id: Date.now().toString(),
      content: message,
      timestamp: new Date().toISOString(),
      sender: 'user',
      userId
    };
    
    // Save user message
    await cosmosDbService.saveMessage(userMessage);
    
    // Get conversation history
    const history = await cosmosDbService.getConversationHistory(userId);
    
    // Process message with AI
    const conversationState = {}; // For REST API, no flow state is maintained
    const intent = await aiService.detectIntent(message, conversationState);
    
    // Handle simple intents only for REST API
    let responseContent = '';
    
    if (intent.action === 'CHAT') {
      responseContent = intent.response;
    } else if (intent.action === 'QUERY_FLIGHT') {
      try {
        console.log('Processing QUERY_FLIGHT intent with parameters:', JSON.stringify(intent.parameters));
        
        // Call the flight search API
        const flights = await ApiAdapters.searchFlights(intent.parameters);
        console.log('Flight search result count:', flights ? flights.length : 0);
        
        // Pass the result to the AI to generate a natural response
        const aiPrompt = `You are an airline flight search assistant. The user searched for flights with these parameters: ${JSON.stringify(intent.parameters)}. 
The search API returned these results: ${JSON.stringify(flights)}. 
Please generate a natural, conversational response about the search results.
If flights were found, mention how many and summarize them with details like flight numbers, departure/arrival times and prices.
If no flights were found, suggest alternatives politely.
End with an appropriate question about whether they want to book a flight or refine their search.`;
        
        // Generate response using AI
        const aiResponse = await aiService.generateResponse([
          { sender: 'system', content: aiPrompt },
          { sender: 'user', content: message }
        ]);
        
        responseContent = aiResponse;
      } catch (error) {
        console.error('Error in QUERY_FLIGHT flow:', error);
        
        // Even for errors, use AI to generate a response
        const aiPrompt = `You are an airline flight search assistant. The user tried to search for flights but there was an error: "${error.message}".
Please generate a natural, conversational response apologizing for the issue and suggesting they try again or modify their search criteria.`;
        
        try {
          const aiResponse = await aiService.generateResponse([
            { sender: 'system', content: aiPrompt },
            { sender: 'user', content: message }
          ]);
          responseContent = aiResponse;
        } catch (innerError) {
          console.error('Error generating AI response for flight search error:', innerError);
          responseContent = "I'm sorry, I encountered an error while searching for flights. Please try again.";
        }
      }
    } else if (intent.action === 'BUY_TICKET') {
      try {
        console.log('Processing BUY_TICKET intent with parameters:', JSON.stringify(intent.parameters));
        
        // Call the booking API
        const ticketResult = await ApiAdapters.bookTicket(intent.parameters);
        console.log('Ticket booking result:', JSON.stringify(ticketResult));
        
        // Pass the result to the AI to generate a natural response
        const aiPrompt = `You are an airline booking assistant. The user tried to book a ticket with these details: ${JSON.stringify(intent.parameters)}. 
The booking API returned this result: ${JSON.stringify(ticketResult)}. 
Please generate a natural, conversational response about the booking status. 
If there was an error, explain it politely and suggest what they might do to fix it.
If it was successful, confirm the booking in a friendly way.`;
        
        // Generate response using AI
        const aiResponse = await aiService.generateResponse([
          { sender: 'system', content: aiPrompt },
          { sender: 'user', content: message }
        ]);
        
        responseContent = aiResponse;
      } catch (error) {
        console.error('Error in BUY_TICKET flow:', error);
        responseContent = "I'm sorry, I encountered an error while booking your ticket. Please try again.";
      }
    } else if (intent.action === 'CHECK_IN') {
      try {
        console.log('Processing CHECK_IN intent with parameters:', JSON.stringify(intent.parameters));
        
        // Call the check-in API
        const checkInResult = await ApiAdapters.checkIn(intent.parameters);
        console.log('Check-in result:', JSON.stringify(checkInResult));
        
        // Pass the result to the AI to generate a natural response
        const aiPrompt = `You are an airline check-in assistant. The user tried to check in with these details: ${JSON.stringify(intent.parameters)}. 
The check-in API returned this result: ${JSON.stringify(checkInResult)}. 
Please generate a natural, conversational response about the check-in status. 
If there was an error, explain it politely and suggest what they might do to fix it.
If it was successful, confirm the check-in in a friendly way.`;
        
        // Generate response using AI
        const aiResponse = await aiService.generateResponse([
          { sender: 'system', content: aiPrompt },
          { sender: 'user', content: message }
        ]);
        
        responseContent = aiResponse;
      } catch (error) {
        console.error('Error in CHECK_IN flow:', error);
        responseContent = "I'm sorry, I encountered an error while processing your check-in. Please try again.";
      }
    } else {
      responseContent = "I'm sorry, I'm not able to process that request right now. Could you try again or rephrase your request?";
    }
    
    // Create assistant response
    const assistantMessage = {
      id: (Date.now() + 1).toString(),
      content: responseContent,
      timestamp: new Date().toISOString(),
      sender: 'bot',
      userId
    };
    
    // Save assistant message
    await cosmosDbService.saveMessage(assistantMessage);
    
    // Return response
    return res.status(200).json({
      message: assistantMessage,
      history: [...history, userMessage, assistantMessage]
    });
    
  } catch (error) {
    console.error('Error in chat API:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Get conversation history
app.get('/api/history', async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'Missing userId parameter' });
    }
    
    const history = await cosmosDbService.getConversationHistory(userId);
    return res.status(200).json(history);
    
  } catch (error) {
    console.error('Error fetching conversation history:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Clear conversation history
app.delete('/api/history', async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'Missing userId parameter' });
    }
    
    const success = await cosmosDbService.deleteConversationHistory(userId);
    
    if (success) {
      return res.status(200).json({ message: 'History cleared successfully' });
    } else {
      return res.status(500).json({ error: 'Failed to clear history' });
    }
    
  } catch (error) {
    console.error('Error clearing conversation history:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Start the server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`API Gateway running on port ${PORT}`);
  console.log(`Server environment: ${process.env.NODE_ENV || 'development'}`);
}); 