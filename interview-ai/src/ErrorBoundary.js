import React, { Component } from 'react';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <h3>Something went wrong with the feedback system.</h3>
          <button onClick={() => window.location.reload()}>
            Reload Interview
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;