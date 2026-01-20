import React from 'react'
import CellularSettingsCard from './cellular-settings-card'
import CellularAMBRCard from './cellular-ambr'

const CellularSettingsComponent = () => {
  return (
        <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">
            Cellular Basic Settings
        </h1>
        <p className="text-muted-foreground max-w-5xl">
            Configure the basic settings for your cellular connection to ensure optimal performance and connectivity.
        </p>
      </div>
      <div className="grid grid-cols-1 @xl/main:grid-cols-2 @5xl/main:grid-cols-2 grid-flow-row gap-4 *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:shadow-xs">
        <CellularSettingsCard />
        <CellularAMBRCard />
      </div>
    </div>
  )
}

export default CellularSettingsComponent