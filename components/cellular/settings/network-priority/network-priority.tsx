import React from 'react'
import NetworkPriorityCard from './network-priority-card'

const NetworkPrioritySettings = () => {
  return (
        <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">
            Network Priority Settings
        </h1>
        <p className="text-muted-foreground max-w-5xl">
            Set and manage the priority of your network connections to ensure optimal performance and data usage.
        </p>
      </div>
      <div className="grid grid-cols-1 @xl/main:grid-cols-2 @5xl/main:grid-cols-2 grid-flow-row gap-4 *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:shadow-xs">
            <NetworkPriorityCard />
      </div>
    </div>
  )
}

export default NetworkPrioritySettings