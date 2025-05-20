const OpenAI = require('openai');

class AiService {
  constructor(apiKey) {
    try {
      this.openai = new OpenAI({
        apiKey: apiKey || process.env.OPENAI_API_KEY
      });
      console.log('AiService initialized with API key:', apiKey ? 'Key provided in constructor' : 'Using environment variable');
    } catch (error) {
      console.error('Error initializing OpenAI:', error);
      this.openai = null;
    }
  }

  // Detect intent from user message
  async detectIntent(message, conversationState = {}) {
    try {
      console.log('Detecting intent for message:', message);
      console.log('Current conversation state:', conversationState);
      
      // If OpenAI client is not available, throw an error
      if (!this.openai) {
        throw new Error('OpenAI client is not available. Please check your API key.');
      }
      
      console.log('Making OpenAI API request...');
      const startTime = new Date();
      
      // Prepare conversation context for the model
      const messages = [
        {
          role: "system",
          content: this.getSystemPrompt(conversationState)
        },
        {
          role: "user",
          content: message
        }
      ];
      
      // If we have an active flow, add context about where we are in the flow
      if (conversationState.activeFlow) {
        messages.push({
          role: "system",
          content: `Current flow: ${conversationState.activeFlow}, current step: ${conversationState.currentStep}, collected parameters: ${JSON.stringify(conversationState.collectedParams || {})}`
        });
      }
      
      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: messages,
        temperature: 0,
        response_format: { type: "json_object" }
      });
      
      const endTime = new Date();
      console.log(`OpenAI request completed in ${endTime - startTime}ms`);
      console.log('OpenAI response received:', completion.choices[0].message.content);
      
      try {
        const parsedResponse = JSON.parse(completion.choices[0].message.content);
        
        // Process the response for multi-step flows
        if (conversationState.activeFlow && parsedResponse.action === 'CONTINUE_FLOW') {
          return this.processFlowStep(parsedResponse, conversationState);
        }
        
        return parsedResponse;
      } catch (parseError) {
        console.error('Error parsing OpenAI response:', parseError);
        console.error('Raw response content:', completion.choices[0].message.content);
        throw new Error('Failed to parse AI response');
      }
    } catch (error) {
      console.error('Error detecting intent with OpenAI:', error.message);
      console.error('Full error details:', JSON.stringify({
        name: error.name,
        message: error.message,
        code: error.code,
        status: error.status,
        type: error.type
      }));
      
      if (error.response) {
        console.error('OpenAI API error response:', JSON.stringify(error.response.data));
      }
      
      // Return a simple error response instead of falling back to rule-based processing
      return { 
        action: 'CHAT', 
        response: "I'm sorry, I'm having trouble understanding right now. Could you try again or rephrase your request?" 
      };
    }
  }
  
  // Process a flow step from the AI response
  processFlowStep(response, conversationState) {
    // Simply pass through the AI's decision about the flow
    return response;
  }
  
  // Get the appropriate system prompt based on the conversation state
  getSystemPrompt(conversationState) {
    // Basic prompt for all conversations
    let prompt = `You are an AI assistant for an airline ticketing system.
    Your main role is to have natural conversations with users and extract intents and parameters when users request flight-related services.
    
    Return a JSON object with the action and parameters. Possible actions include:
    
    1. CHAT: For general conversation, questions, or any input not explicitly related to booking flights, checking in, etc.
    2. QUERY_FLIGHT: When user asks to search for flights.
    3. BUY_TICKET: When user wants to purchase a ticket.
    4. CHECK_IN: When user wants to check in for a flight.
    5. START_QUERY_FLOW: When user wants to search for flights but doesn't provide all parameters.
    6. START_BUY_FLOW: When user wants to book a flight but doesn't provide all details.
    7. START_CHECKIN_FLOW: When user wants to check in but doesn't provide all details.
    8. CONTINUE_FLOW: When user is responding in a multi-step flow.
    
    For QUERY_FLIGHT, extract these parameters if provided:
    - origin (airport code or city name)
    - destination (airport code or city name)
    - dateFrom (in YYYY-MM-DDThh:mm:ss.0000000 format or YYYY-MM-DD)
    - dateTo (in YYYY-MM-DDThh:mm:ss.0000000 format or YYYY-MM-DD)
    - passengers (number as string)
    
    For BUY_TICKET, extract these parameters if provided:
    - flightNumber (e.g., "FL3940")
    - flightDate (in format: "YYYY-MM-DD" or fuller format with time)
    - passengerNames (array of passenger names)
    
    For CHECK_IN, extract these parameters if provided:
    - flightNumber (e.g., "FL3940")
    - date (in format: "YYYY-MM-DD" or fuller format with time)
    - passengerName (string with passenger name)
    
    For CHAT, include a suggested response in the "response" field.`;
    
    // If we're in an active flow, add specific instructions for that flow
    if (conversationState.activeFlow) {
      prompt += `\n\nThe user is currently in a ${conversationState.activeFlow} flow, at step ${conversationState.currentStep}.
      Previously collected parameters: ${JSON.stringify(conversationState.collectedParams || {})}.
      
      For CONTINUE_FLOW responses, include:
      - flow: The current flow type
      - nextStep: The next step in the flow
      - collectedParams: Object with all parameters collected so far, including the new one from this message
      
      Extract and add the appropriate parameter from the user's current message to the collectedParams.`;
    }
    
    return prompt;
  }

  // Generate conversational response
  async generateResponse(conversation, intent) {
    try {
      const messages = [
        {
          role: "system",
          content: `You are a helpful airline ticketing assistant. 
          You help users find flights, book tickets, and check in for their flights.
          Provide concise, user-friendly responses.`
        },
        ...conversation.map(msg => ({
          role: msg.sender === 'user' ? 'user' : 'assistant',
          content: msg.content
        }))
      ];

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages,
        temperature: 0.7,
        max_tokens: 150
      });

      return completion.choices[0].message.content;
    } catch (error) {
      console.error('Error generating response with OpenAI:', error);
      return "I'm sorry, I encountered an issue. Can you please try again?";
    }
  }
}

module.exports = AiService; 