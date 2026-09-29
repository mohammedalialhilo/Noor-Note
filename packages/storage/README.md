# @noor-note/storage

`NoteRepository` is the interface used by the application. `DexieNoteRepository`
implements it with IndexedDB through Dexie. Construct it after the browser mounts;
the module can be imported during server rendering, but constructing the repository
without `window` and IndexedDB throws a clear error.

`put()` validates each note with the core schema. `importNotes()` validates the
entire input first, then upserts all notes in one IndexedDB transaction. A failed
validation writes nothing. `list()` returns notes by most recent update, and
`close()` releases the database connection. The current database schema is version
1; future data model changes will need explicit Dexie migrations.
