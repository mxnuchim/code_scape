from flask import Flask

from .routes import bp


def create_app():
    """Create the Flask application."""
    app = Flask(__name__)
    app.register_blueprint(bp)
    return app
