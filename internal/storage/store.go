package storage

import (
	"errors"
	"fmt"
	"os"
	"slices"
	"time"
)

var (
	ErrMalformedRows = errors.New("the file has malformed rows; fix them in the file first")
	ErrNotFound      = errors.New("not found")
)

// fileStamp is the cheap part of a file's identity: if it is unchanged, the content is assumed unchanged.
type fileStamp struct {
	exists bool
	size   int64
	mod    time.Time
}

func stampOf(path string) fileStamp {
	info, err := os.Stat(path)
	if err != nil {
		return fileStamp{}
	}
	return fileStamp{exists: true, size: info.Size(), mod: info.ModTime()}
}

func (f fileStamp) equal(other fileStamp) bool {
	return f.exists == other.exists && f.size == other.size && f.mod.Equal(other.mod)
}

// store keeps one CSV file's rows in memory and in step with the file.
type store[T any] struct {
	path   string
	format format[T]
	now    func() time.Time

	items    []T
	problems []Problem
	hash     string
	stamp    fileStamp
	unsaved  bool
}

func openStore[T any](path string, f format[T]) (*store[T], error) {
	s := &store[T]{path: path, format: f, now: time.Now}
	if err := s.reload(); err != nil {
		return nil, err
	}
	return s, nil
}

// Problems lists the rows that could not be read.
func (s *store[T]) Problems() []Problem {
	return s.problems
}

// Unsaved reports that the last save failed and memory is ahead of the file.
func (s *store[T]) Unsaved() bool {
	return s.unsaved
}

// Save retries writing the in-memory rows.
func (s *store[T]) Save() error {
	if err := s.checkEditable(); err != nil {
		return err
	}
	return s.save()
}

// CheckExternalChange reloads the file if it changed on disk and reports whether it did.
func (s *store[T]) CheckExternalChange() (bool, error) {
	if stamp := stampOf(s.path); stamp.equal(s.stamp) {
		return false, nil
	}
	hash, err := FileHash(s.path)
	if err != nil {
		return false, err
	}
	if hash == s.hash {
		s.stamp = stampOf(s.path)
		return false, nil
	}
	return true, s.reload()
}

func (s *store[T]) append(item T) error {
	if err := s.checkEditable(); err != nil {
		return err
	}
	s.items = append(s.items, item)
	return s.save()
}

func (s *store[T]) replace(id string, item T) error {
	if err := s.checkEditable(); err != nil {
		return err
	}
	i := s.indexOf(id)
	if i < 0 {
		return ErrNotFound
	}
	s.items[i] = item
	return s.save()
}

func (s *store[T]) remove(id string) error {
	if err := s.checkEditable(); err != nil {
		return err
	}
	i := s.indexOf(id)
	if i < 0 {
		return ErrNotFound
	}
	s.items = slices.Delete(s.items, i, i+1)
	return s.save()
}

func (s *store[T]) find(id string) (T, bool) {
	i := s.indexOf(id)
	if i < 0 {
		var zero T
		return zero, false
	}
	return s.items[i], true
}

func (s *store[T]) checkEditable() error {
	if len(s.problems) > 0 {
		return ErrMalformedRows
	}
	return nil
}

func (s *store[T]) indexOf(id string) int {
	return slices.IndexFunc(s.items, func(item T) bool { return *s.format.id(&item) == id })
}

func (s *store[T]) reload() error {
	stamp := stampOf(s.path)
	loaded, err := readTable(s.path, s.format)
	if err != nil {
		return err
	}
	s.items, s.problems, s.hash, s.stamp, s.unsaved = loaded.items, loaded.problems, loaded.hash, stamp, false
	return nil
}

func (s *store[T]) save() error {
	hash, err := saveTable(s.path, s.items, s.format, s.hash, s.now())
	if errors.Is(err, ErrExternalChange) {
		if reloadErr := s.reload(); reloadErr != nil {
			return reloadErr
		}
		return fmt.Errorf("%w; it was reloaded and your last change was not saved", err)
	}
	if err != nil {
		s.unsaved = true
		return err
	}
	s.hash, s.stamp, s.unsaved = hash, stampOf(s.path), false
	return nil
}
