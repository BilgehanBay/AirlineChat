import React from 'react';

const ChatMessage = ({ message }) => {
  const { content, sender } = message;
  
  const formatMessage = (text) => {
    // Handle flight details formatting
    if (text.includes('Flight:') && text.includes('Passengers:')) {
      return text.split('\n').map((line, i) => (
        <p key={i}>{line}</p>
      ));
    }
    return text;
  };

  return (
    <div className={`message ${sender === 'user' ? 'user-message' : 'bot-message'}`}>
      <div className="message-content">
        {formatMessage(content)}
      </div>
    </div>
  );
};

export default ChatMessage; 