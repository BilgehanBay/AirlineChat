import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import ChatMessage from './components/ChatMessage';
import axios from 'axios';

const API_URL = 'https://airlinechat-api.azurewebsites.net/api';

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const userIdRef = useRef(null);
  // Use a map to track messages by their content hash to prevent duplicates
  const messageMapRef = useRef(new Map());

  // Function to generate a content hash for deduplication
  const getMessageHash = (message) => {
    // Include timestamp in the hash to allow duplicate content at different times
    return `${message.sender}-${message.content}-${message.timestamp || Date.now()}`;
  };

  // Initialize the userId when the component mounts
  useEffect(() => {
    // Generate a unique ID for this session
    const sessionId = localStorage.getItem('chatSessionId');
    if (sessionId) {
      userIdRef.current = sessionId;
    } else {
      // Generate a new user ID using timestamp and random string
      const newUserId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('chatSessionId', newUserId);
      userIdRef.current = newUserId;
    }
    console.log('Session ID:', userIdRef.current);
    
    // Fetch conversation history
    fetchConversationHistory();
  }, []);

  // Fetch conversation history from the server
  const fetchConversationHistory = async () => {
    try {
      const response = await axios.get(`${API_URL}/history?userId=${userIdRef.current}`, {
        timeout: 10000
      });
      
      console.log('Fetched conversation history:', response.data);
      
      if (response.data && Array.isArray(response.data)) {
        // Add all messages to the map to avoid duplicates
        const history = response.data;
        
        // Skip history if it's empty
        if (history.length === 0) {
          // Add welcome message if no history
          addWelcomeMessage();
          return;
        }
        
        // Process each message in history
        history.forEach(message => {
          const messageHash = getMessageHash(message);
          messageMapRef.current.set(messageHash, true);
        });
        
        setMessages(history);
      } else {
        // Add welcome message if no history
        addWelcomeMessage();
      }
    } catch (error) {
      console.error('Error fetching conversation history:', error);
      // Add welcome message if error
      addWelcomeMessage();
    }
  };
  
  // Add welcome message
  const addWelcomeMessage = () => {
    const welcomeMessage = {
      id: 'welcome',
      content: "Hello! I'm your airline assistant. How can I help you today?",
      sender: 'bot',
      timestamp: new Date().toISOString()
    };
    
    // Generate a content hash for this message
    const welcomeHash = getMessageHash(welcomeMessage);
    
    // Track the welcome message
    messageMapRef.current.set(welcomeHash, true);
    
    setMessages([welcomeMessage]);
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Add a function to clear chat
  const clearChat = () => {
    setMessages([]);
    messageMapRef.current.clear();
    
    // Add a welcome message
    const welcomeMessage = {
      id: 'welcome-' + new Date().toISOString(),
      content: "Hello! I'm your airline assistant. How can I help you today?",
      sender: 'bot',
      timestamp: new Date().toISOString()
    };
    
    // Track the welcome message
    const welcomeHash = getMessageHash(welcomeMessage);
    messageMapRef.current.set(welcomeHash, true);
    
    setMessages([welcomeMessage]);
    
    // Clear conversation history on server
    try {
      axios.delete(`${API_URL}/history?userId=${userIdRef.current}`);
    } catch (error) {
      console.error('Error clearing conversation history:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage = {
      id: new Date().toISOString(),
      content: input,
      sender: 'user',
      timestamp: new Date().toISOString()
    };

    // Generate a content hash for this message
    const messageHash = getMessageHash(userMessage);
    
    // If we haven't displayed this message content yet, add it
    if (!messageMapRef.current.has(messageHash)) {
      // Track that we've displayed this message content
      messageMapRef.current.set(messageHash, true);
      
      // Add message to the UI
      setMessages(prevMessages => [...prevMessages, userMessage]);
    }
    
    setInput('');
    setIsLoading(true);

    try {
      console.log('Sending message to API:', input);
      
      // Add timeout to the request
      const response = await axios.post(`${API_URL}/chat`, { 
        message: input,
        userId: userIdRef.current // Add user ID for conversation tracking
      }, {
        timeout: 15000, // 15 second timeout
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      console.log('API response:', response.data);
      
      // Process bot response
      if (response.data && response.data.message) {
        const botResponse = {
          id: new Date().toISOString() + '-api',
          content: response.data.message.content,
          sender: 'bot',
          timestamp: new Date().toISOString()
        };
        
        // Generate a content hash for this message
        const botMessageHash = getMessageHash(botResponse);
        
        // If we haven't displayed this message content yet, add it
        if (!messageMapRef.current.has(botMessageHash)) {
          // Track that we've displayed this message content
          messageMapRef.current.set(botMessageHash, true);
          
          // Add bot response to the UI
          setMessages(prevMessages => [...prevMessages, botResponse]);
        }
      }
    } catch (error) {
      console.error('Error sending message:', error);
      
      const errorMessage = {
        id: new Date().toISOString() + '-error',
        content: 'Sorry, there was an error processing your request. Please try again later.',
        sender: 'bot',
        timestamp: new Date().toISOString()
      };
      
      // Generate a content hash for this message
      const errorMessageHash = getMessageHash(errorMessage);
      
      // If we haven't displayed this message content yet, add it
      if (!messageMapRef.current.has(errorMessageHash)) {
        // Track that we've displayed this message content
        messageMapRef.current.set(errorMessageHash, true);
        
        // Add error message to the UI
        setMessages(prevMessages => [...prevMessages, errorMessage]);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Airline Ticketing Assistant</h1>
        <button onClick={clearChat} className="clear-chat-btn">Clear Chat</button>
      </header>
      <div className="chat-container">
        <div className="messages-container">
          {messages.map((message, index) => (
            <ChatMessage 
              key={message.id || index} 
              message={message}
            />
          ))}
          {isLoading && (
            <div className="message bot-message">
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
        <form onSubmit={handleSubmit} className="input-form">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message here..."
            disabled={isLoading}
          />
          <button type="submit" disabled={isLoading}>Send</button>
        </form>
      </div>
    </div>
  );
}

export default App; 