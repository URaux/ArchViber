// Dispatcher loops a Queue, runs handlers, and acks results.
package main

import (
	"context"
	"fmt"
	"log"
)

// Handler processes one Job and reports success.
type Handler interface {
	Handle(ctx context.Context, job *Job) error
}

// HandlerFunc adapts a plain function into a Handler.
type HandlerFunc func(ctx context.Context, job *Job) error

// Handle calls f.
func (f HandlerFunc) Handle(ctx context.Context, job *Job) error {
	return f(ctx, job)
}

// Dispatcher runs the worker loop.
type Dispatcher struct {
	queue   Queue
	handler Handler
}

// NewDispatcher returns a Dispatcher with a default echo handler.
func NewDispatcher(q Queue) *Dispatcher {
	return &Dispatcher{
		queue:   q,
		handler: HandlerFunc(echoHandler),
	}
}

// Run pumps jobs from the queue until ctx fires.
func (d *Dispatcher) Run(ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		job, err := d.queue.Pop(ctx)
		if err != nil {
			log.Printf("pop error: %v", err)
			return err
		}

		if err := d.handler.Handle(ctx, job); err != nil {
			_ = d.queue.Fail(ctx, job.ID, err.Error())
			continue
		}
		_ = d.queue.Ack(ctx, job.ID)
	}
}

func echoHandler(_ context.Context, job *Job) error {
	if job == nil || job.ID == "" {
		return fmt.Errorf("invalid job")
	}
	return nil
}
