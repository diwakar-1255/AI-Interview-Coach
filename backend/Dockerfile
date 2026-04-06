# Use an official lightweight Python image.
FROM python:3.10-slim

# Set environment variables to prevent Python from writing pyc files and buffering stdout.
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Set the working directory in the container
WORKDIR /app

# Copy requirements.txt and install dependencies
COPY requirements.txt .
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code into the container
COPY . .

# Expose port 5000 (the port our Flask app uses)
EXPOSE 5000

# Run the application using Gunicorn with eventlet (for Socket.IO)
CMD ["gunicorn", "--worker-class", "eventlet", "-w", "1", "--bind", "0.0.0.0:5000", "app:app"]
