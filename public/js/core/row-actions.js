(function () {
  function bind(container, handlersByEvent) {
    Object.entries(handlersByEvent || {}).forEach(([eventName, handlers]) => {
      container.addEventListener(eventName, (event) => {
        for (const handler of handlers) {
          const match = handler.closest ? event.target.closest(handler.selector) : event.target.matches(handler.selector) ? event.target : null;
          if (!match) continue;
          handler.handle(event, match);
          return;
        }
      });
    });
  }

  window.RowActionHelpers = {
    bind,
  };
})();
