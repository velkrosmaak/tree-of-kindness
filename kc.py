import sqlite3
from flask import Flask, render_template, jsonify, request, g

DATABASE = 'cobnuts.db'

app = Flask(__name__)
app.secret_key = 'your_very_secret_key' # Important for session management if used later

# --- Database Helper Functions ---
def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row # Access columns by name
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    with app.app_context():
        db = get_db()
        with app.open_resource('schema.sql', mode='r') as f:
            db.cursor().executescript(f.read())
        db.commit()
        # Check if initial data exists, if not, insert it
        cursor = db.execute("SELECT * FROM cobnuts_tracker WHERE id = 1")
        if cursor.fetchone() is None:
            db.execute("INSERT INTO cobnuts_tracker (id, current_cobnuts_in_jar, total_cobnuts_earned) VALUES (1, 0, 0)")
            db.commit()
        print("Database initialized.")

def query_db(query, args=(), one=False):
    cur = get_db().execute(query, args)
    rv = cur.fetchall()
    cur.close()
    return (rv[0] if rv else None) if one else rv

# --- Routes ---
@app.route('/')
def index():
    """Render the main page."""
    return render_template('index.html')

@app.route('/get_cobnuts_status', methods=['GET'])
def get_cobnuts_status():
    """Fetch the current and total cobnuts."""
    status = query_db("SELECT current_cobnuts_in_jar, total_cobnuts_earned FROM cobnuts_tracker WHERE id = 1", one=True)
    if status:
        return jsonify({
            'current_cobnuts': status['current_cobnuts_in_jar'],
            'total_cobnuts': status['total_cobnuts_earned']
        })
    return jsonify({'current_cobnuts': 0, 'total_cobnuts': 0}) # Default if DB is empty somehow

@app.route('/add_cobnut', methods=['POST'])
def add_cobnut():
    """Add a cobnut to the jar."""
    db = get_db()
    current_status = query_db("SELECT current_cobnuts_in_jar, total_cobnuts_earned FROM cobnuts_tracker WHERE id = 1", one=True)

    if not current_status:
        # This should not happen if init_db worked
        return jsonify({'error': 'Database not initialized properly'}), 500

    current_cobnuts = current_status['current_cobnuts_in_jar']
    total_cobnuts = current_status['total_cobnuts_earned']

    new_current_cobnuts = current_cobnuts + 1
    new_total_cobnuts = total_cobnuts + 1
    animation_triggered = False

    if new_current_cobnuts >= 10:
        animation_triggered = True
        # In a real scenario, we might reset after animation confirmation from client
        # For simplicity, resetting here.
        db.execute("UPDATE cobnuts_tracker SET current_cobnuts_in_jar = 0, total_cobnuts_earned = ? WHERE id = 1",
                   (new_total_cobnuts,))
        db.commit()
        # After commit, the value for response should be 0 for current, and updated total.
        # However, for the immediate UI update before animation, the client might expect 10.
        # We'll return the state that caused the animation.
        response_current_cobnuts = 10 # The state that triggered the animation
    else:
        db.execute("UPDATE cobnuts_tracker SET current_cobnuts_in_jar = ?, total_cobnuts_earned = ? WHERE id = 1",
                   (new_current_cobnuts, new_total_cobnuts))
        db.commit()
        response_current_cobnuts = new_current_cobnuts

    return jsonify({
        'message': 'Cobnut added!',
        'current_cobnuts': response_current_cobnuts, # Or new_current_cobnuts if you reset instantly
        'total_cobnuts': new_total_cobnuts,
        'animation_triggered': animation_triggered
    })

@app.route('/reset_jar_after_animation', methods=['POST'])
def reset_jar_after_animation():
    """Resets the current cobnuts in the jar to 0, typically called after the animation plays."""
    db = get_db()
    db.execute("UPDATE cobnuts_tracker SET current_cobnuts_in_jar = 0 WHERE id = 1")
    db.commit()
    current_status = query_db("SELECT current_cobnuts_in_jar, total_cobnuts_earned FROM cobnuts_tracker WHERE id = 1", one=True)
    return jsonify({
        'message': 'Jar reset after animation.',
        'current_cobnuts': current_status['current_cobnuts_in_jar'],
        'total_cobnuts': current_status['total_cobnuts_earned']
    })


# --- CLI command to initialize DB ---
@app.cli.command('initdb')
def initdb_command():
    """Initializes the database."""
    init_db()
    print('Initialized the database.')

if __name__ == '__main__':
    # Create schema.sql if it doesn't exist
    with open('schema.sql', 'w') as f:
        f.write("""
        DROP TABLE IF EXISTS cobnuts_tracker;
        CREATE TABLE cobnuts_tracker (
            id INTEGER PRIMARY KEY CHECK (id = 1), -- Ensures only one row
            current_cobnuts_in_jar INTEGER NOT NULL DEFAULT 0,
            total_cobnuts_earned INTEGER NOT NULL DEFAULT 0
        );
        """)
    init_db() # Initialize DB on first run if schema.sql is present
    app.run(debug=True, port=5001) # Using a different port in case 5000 is in use